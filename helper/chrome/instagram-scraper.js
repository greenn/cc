(() => {
  if (window.__CC_INSTAGRAM_SCRAPER_INSTALLED__) return;
  window.__CC_INSTAGRAM_SCRAPER_INSTALLED__ = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let lastProgressAt = 0;
  let lastProgressSignature = '';
  let nextBatchId = 1;

  function reportProgress(sourceId, progress = {}, force = false) {
    if (!sourceId) return;
    const payload = {
      passId: String(progress.passId || ''),
      phase: String(progress.phase || 'collecting'),
      collected: Math.max(0, Number(progress.collected || 0)),
      streamed: Math.max(0, Number(progress.streamed || 0)),
      clicks: Math.max(0, Number(progress.clicks || 0)),
      scrollMoves: Math.max(0, Number(progress.scrollMoves || 0)),
      pageDowns: Math.max(0, Number(progress.pageDowns || 0)),
      manualScrollMoves: Math.max(0, Number(progress.manualScrollMoves || 0)),
      step: Math.max(0, Number(progress.step || 0)),
      maxSteps: Math.max(0, Number(progress.maxSteps || 0)),
      stableRounds: Math.max(0, Number(progress.stableRounds || 0)),
      stableLimit: Math.max(0, Number(progress.stableLimit || 0)),
      timestamp: Date.now(),
    };
    const signature = `${payload.passId}:${payload.phase}:${payload.collected}:${payload.streamed}:${payload.clicks}:${payload.scrollMoves}:${payload.pageDowns}:${payload.manualScrollMoves}:${payload.step}`;
    const now = Date.now();
    if (!force && now - lastProgressAt < 280 && signature === lastProgressSignature) return;
    if (!force && now - lastProgressAt < 180) return;
    lastProgressAt = now;
    lastProgressSignature = signature;
    chrome.runtime.sendMessage({ type: 'CC_INSTAGRAM_PROGRESS', sourceId, progress: payload }, () => {
      void chrome.runtime.lastError;
    });
  }

  function streamComments(sourceId, passId, comments, meta = {}) {
    if (!sourceId || !comments.length) return;
    for (let start = 0; start < comments.length; start += 25) {
      const chunk = comments.slice(start, start + 25);
      chrome.runtime.sendMessage({
        type: 'CC_INSTAGRAM_COMMENT_BATCH',
        sourceId,
        passId,
        batchId: `${passId || sourceId}:${Date.now()}:${nextBatchId++}`,
        comments: chunk,
        meta: { ...meta, batchSize: chunk.length, timestamp: Date.now() },
      }, () => {
        void chrome.runtime.lastError;
      });
    }
  }

  function simpleHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function isLoggedOut() {
    return location.pathname.includes('/accounts/login')
      || Boolean(document.querySelector('input[name="username"], input[name="password"]'));
  }

  function isReelPage() {
    return /^\/reels?\//i.test(location.pathname);
  }

  function isVisible(node) {
    if (!(node instanceof Element)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function commentsDialog() {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(isVisible);
    return dialogs.find((dialog) => {
      const heading = [...dialog.querySelectorAll('h1, h2, h3, [role="heading"]')]
        .map((node) => (node.textContent || '').trim())
        .join(' ');
      if (/comments?|комментар/i.test(heading)) return true;
      return [...dialog.querySelectorAll('textarea, input[placeholder]')].some((field) =>
        /comment|комментар/i.test(field.getAttribute('placeholder') || '')
      );
    }) || null;
  }

  function commentsPanelOpen() {
    if (commentsDialog()) return true;
    return [...document.querySelectorAll('textarea, input[placeholder]')].some((field) =>
      isVisible(field) && /comment|комментар/i.test(field.getAttribute('placeholder') || '')
    );
  }

  function visibleClickable(node) {
    const clickable = node?.closest?.('button, [role="button"], a[href]');
    return clickable && isVisible(clickable) ? clickable : null;
  }

  function commentActionButton() {
    const found = [];
    const seen = new Set();
    const push = (node) => {
      const clickable = visibleClickable(node);
      if (!clickable || seen.has(clickable)) return;
      seen.add(clickable);
      found.push(clickable);
    };

    document.querySelectorAll('[aria-label], [title]').forEach((node) => {
      const label = `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`.trim();
      if (!label || /add (?:a )?comment|добавить комментар/i.test(label)) return;
      if (/^(?:view )?comments?$|^comment$|комментари|комментировать/i.test(label)) push(node);
    });
    document.querySelectorAll('svg[aria-label]').forEach((node) => {
      const label = node.getAttribute('aria-label') || '';
      if (/^(?:view )?comments?$|^comment$|комментари|комментировать/i.test(label)) push(node);
    });
    return found[0] || null;
  }

  async function openReelCommentsIfNeeded(timeoutMs = 12000) {
    if (!isReelPage()) return { reelPage: false, clickAttempted: false, opened: commentsPanelOpen() };
    if (commentsPanelOpen()) return { reelPage: true, clickAttempted: false, opened: true };

    const deadline = Date.now() + timeoutMs;
    let clickAttempted = false;
    while (Date.now() < deadline) {
      if (commentsPanelOpen()) return { reelPage: true, clickAttempted, opened: true };
      const action = commentActionButton();
      if (action) {
        clickAttempted = true;
        try {
          action.scrollIntoView({ block: 'center', inline: 'nearest' });
          await sleep(150);
          action.click();
          await sleep(1100);
        } catch {
          // Instagram can replace the action while the Reel UI settles.
        }
      }
      await sleep(400);
    }
    return { reelPage: true, clickAttempted, opened: commentsPanelOpen() };
  }

  function isProfileHref(value) {
    const href = String(value || '');
    return /^\/[A-Za-z0-9._]+\/?(?:\?.*)?$/.test(href)
      && !href.startsWith('/explore/')
      && !href.startsWith('/accounts/')
      && !href.startsWith('/direct/');
  }

  function profileAnchor(node) {
    return [...node.querySelectorAll('a[href]')].find((anchor) => isProfileHref(anchor.getAttribute('href'))) || null;
  }

  function usernameFromAnchor(anchor) {
    return (anchor?.getAttribute('href') || '').split('?')[0].split('/').filter(Boolean)[0]
      || (anchor?.textContent || '').trim();
  }

  function isUiText(text, username = '') {
    const value = String(text || '').trim();
    if (!value || value === username || value === `@${username}`) return true;
    return /^(reply|replies|like|likes|see translation|edited|more|view replies|view \d+ replies|view all \d+ replies|load more comments|view more comments|view all \d+ comments|\d+[smhdw]|\d+\s*(seconds?|minutes?|hours?|days?|weeks?)\s*ago|ответить|ответы|нравится|показать перевод|изменено|посмотреть ответы|показать ответы|показать все ответы|показать ещё комментарии|загрузить еще комментарии|посмотреть все комментарии)$/i.test(value);
  }

  function cleanCandidateText(node, username) {
    const leaf = [...node.querySelectorAll('span')]
      .filter((span) => !span.querySelector('span'))
      .map((span) => (span.innerText || span.textContent || '').trim())
      .filter((text) => text.length > 1 && !isUiText(text, username))
      .filter((text) => !/^[\d.,\s]+[kKmMкКмМ]?\s*(likes?|отмет)/i.test(text))
      .filter((text) => !/^(view|show|посмотреть|показать)\s+\d+/i.test(text));
    const unique = [...new Set(leaf)];
    if (unique.length) return unique.sort((a, b) => b.length - a.length)[0];

    const lines = (node.innerText || '').split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 1 && !isUiText(line, username))
      .filter((line) => !/^[\d.,\s]+[kKmMкКмМ]?\s*(likes?|отмет)/i.test(line))
      .filter((line) => !/^(view|show|посмотреть|показать)\s+\d+/i.test(line));
    return [...new Set(lines)].sort((a, b) => b.length - a.length)[0] || '';
  }

  function safeHttpUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, location.href);
      return /^https?:$/i.test(url.protocol) ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function mediaKindFromUrl(value) {
    const safe = safeHttpUrl(value);
    if (!safe) return '';
    try {
      const pathname = new URL(safe).pathname.toLowerCase();
      if (/\.(?:gif|gifv|webp|jpe?g|png|avif)$/.test(pathname)) return 'image';
      if (/\.(?:mp4|webm|mov|m4v)$/.test(pathname)) return 'video';
    } catch {
      return '';
    }
    return '';
  }

  function stableMediaIdentity(value) {
    const safe = safeHttpUrl(value);
    if (!safe) return '';
    try {
      const url = new URL(safe);
      return `${url.origin}${url.pathname}`;
    } catch {
      return safe;
    }
  }

  function srcsetUrl(value) {
    const candidates = String(value || '').split(',')
      .map((part) => part.trim().split(/\s+/)[0])
      .map(safeHttpUrl)
      .filter(Boolean);
    return candidates[candidates.length - 1] || '';
  }

  function backgroundImageUrl(node) {
    if (!(node instanceof Element)) return '';
    const value = getComputedStyle(node).backgroundImage || '';
    const match = value.match(/url\(["']?(.*?)["']?\)/i);
    return safeHttpUrl(match?.[1] || '');
  }

  function isProfileMedia(node) {
    const anchor = node?.closest?.('a[href]');
    return Boolean(anchor && isProfileHref(anchor.getAttribute('href')));
  }

  function extractAttachments(node, authorAnchor) {
    const attachments = [];
    const seen = new Set();
    const add = (type, url, previewUrl = '', alt = '') => {
      const direct = safeHttpUrl(url);
      const preview = safeHttpUrl(previewUrl);
      if (!direct && !preview) return;
      const normalizedType = type === 'video' ? 'video' : 'image';
      const key = `${normalizedType}:${stableMediaIdentity(direct || preview)}`;
      if (!key || seen.has(key)) return;
      seen.add(key);
      attachments.push({
        type: normalizedType,
        url: direct,
        previewUrl: preview,
        alt: String(alt || '').trim(),
      });
    };

    for (const image of node.querySelectorAll('img')) {
      if (authorAnchor?.contains(image) || isProfileMedia(image)) continue;
      const alt = image.getAttribute('alt') || image.getAttribute('aria-label') || '';
      const url = safeHttpUrl(image.currentSrc || image.getAttribute('src')) || srcsetUrl(image.getAttribute('srcset'));
      const rect = image.getBoundingClientRect();
      const width = Number(rect.width || image.naturalWidth || 0);
      const height = Number(rect.height || image.naturalHeight || 0);
      const explicitGraphic = mediaKindFromUrl(url) === 'image'
        || /gif|giphy|sticker|стикер|animation|анимац|image|photo|изображ/i.test(alt);
      if (!explicitGraphic && Math.max(width, height) < 24) continue;
      add('image', url, '', alt);
    }

    for (const source of node.querySelectorAll('picture source[srcset]')) {
      if (authorAnchor?.contains(source) || isProfileMedia(source)) continue;
      const url = srcsetUrl(source.getAttribute('srcset'));
      if (url) add('image', url, '', source.getAttribute('aria-label') || '');
    }

    for (const graphic of node.querySelectorAll('[role="img"]')) {
      if (authorAnchor?.contains(graphic) || isProfileMedia(graphic)) continue;
      const alt = graphic.getAttribute('aria-label') || graphic.getAttribute('title') || '';
      const url = backgroundImageUrl(graphic);
      if (url) add('image', url, '', alt);
    }

    for (const video of node.querySelectorAll('video')) {
      if (authorAnchor?.contains(video) || isProfileMedia(video)) continue;
      const direct = safeHttpUrl(video.currentSrc)
        || safeHttpUrl(video.getAttribute('src'))
        || safeHttpUrl(video.querySelector('source[src]')?.getAttribute('src'));
      const preview = safeHttpUrl(video.getAttribute('poster'));
      add('video', direct, preview, video.getAttribute('aria-label') || video.getAttribute('title') || '');
    }

    for (const link of node.querySelectorAll('a[href]')) {
      if (link === authorAnchor || isProfileMedia(link)) continue;
      const href = safeHttpUrl(link.getAttribute('href'));
      const kind = mediaKindFromUrl(href);
      if (kind) add(kind, href, '', link.getAttribute('aria-label') || '');
    }

    return attachments;
  }

  function parseNumber(text) {
    const normalized = String(text || '').replace(/\s/g, '').replace(',', '.');
    const match = normalized.match(/(\d+(?:\.\d+)?)([kmкм])?/i);
    if (!match) return 0;
    let value = Number(match[1]);
    if (/^[kк]$/i.test(match[2] || '')) value *= 1000;
    if (/^[mм]$/i.test(match[2] || '')) value *= 1000000;
    return Math.round(value);
  }

  function extractStats(node) {
    const text = node.innerText || '';
    const likes = text.match(/([\d.,\s]+\s*[kKmMкКмМ]?)\s+(?:likes?|отмет(?:ка|ки|ок)\s+«?нравится»?)/i);
    const replies = text.match(/(?:view|show|посмотреть|показать)\s+([\d.,\s]+)\s+(?:repl(?:y|ies)|ответ)/i);
    return {
      likeCount: likes ? parseNumber(likes[1]) : 0,
      replyCount: replies ? parseNumber(replies[1]) : 0,
    };
  }

  function commentPermalink(node) {
    return [...node.querySelectorAll('a[href]')].find((anchor) =>
      /\/c\/|[?&]comment_id=/i.test(anchor.getAttribute('href') || '')
    ) || null;
  }

  function hasCommentEngagement(node) {
    const text = String(node?.innerText || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return /(?:^|\s)(?:Reply|Ответить)(?:\s|$)/i.test(text)
      || /\b\d[\d.,\s]*\s*(?:likes?|отмет(?:ка|ки|ок)\s+«?нравится»?)\b/i.test(text)
      || /(?:view|show|посмотреть|показать)\s+(?:all\s+)?\d+\s+(?:repl(?:y|ies)|ответ)/i.test(text);
  }

  function candidateScore(node) {
    if (!node) return Infinity;
    const author = profileAnchor(node);
    const username = usernameFromAnchor(author);
    if (!username) return Infinity;

    const raw = (node.innerText || '').trim();
    if (raw.length > 3500) return Infinity;

    const permalink = commentPermalink(node);
    const hasTime = Boolean(node.querySelector('time'));
    const engagement = hasCommentEngagement(node);
    if (!hasTime && !permalink && !engagement) return Infinity;

    const text = cleanCandidateText(node, username);
    const attachments = extractAttachments(node, author);
    if (!text && !attachments.length) return Infinity;

    const profileHrefs = new Set([...node.querySelectorAll('a[href]')]
      .map((anchor) => anchor.getAttribute('href') || '')
      .filter(isProfileHref));
    if (profileHrefs.size > 4) return Infinity;

    return Math.max(1, raw.length)
      + profileHrefs.size * 320
      - (permalink ? 180 : 0)
      - (hasTime ? 60 : 0)
      - (engagement ? 80 : 0)
      - attachments.length * 90;
  }

  function nearestCommentContainer(seed, root) {
    let node = seed?.nodeType === Node.ELEMENT_NODE ? seed : seed?.parentElement;
    let best = null;
    let bestScore = Infinity;
    for (let depth = 0; node && depth < 14; depth += 1, node = node.parentElement) {
      if (root && !root.contains(node)) break;
      const score = candidateScore(node);
      if (score < bestScore) {
        best = node;
        bestScore = score;
      }
      if (node.matches?.('li') && best) break;
    }
    return best;
  }

  function commentRoots() {
    const dialog = commentsDialog();
    if (dialog) return [dialog];
    return [document.querySelector('main article'), document.querySelector('article'), document.querySelector('main')].filter(Boolean);
  }

  function commentNodes() {
    const seen = new Set();
    const nodes = [];
    const push = (node) => {
      if (!node || seen.has(node) || candidateScore(node) === Infinity) return;
      seen.add(node);
      nodes.push(node);
    };

    for (const root of commentRoots()) {
      root.querySelectorAll('ul li').forEach(push);
      root.querySelectorAll('a[href*="/c/"], a[href*="comment_id="]').forEach((anchor) => push(nearestCommentContainer(anchor, root)));
      root.querySelectorAll('time').forEach((time) => push(nearestCommentContainer(time, root)));
      root.querySelectorAll('img, video, [role="img"], picture source[srcset]').forEach((media) => push(nearestCommentContainer(media, root)));
    }
    return nodes;
  }

  function collect(url, sourceId) {
    const output = [];
    const seen = new Set();
    for (const node of commentNodes()) {
      const author = profileAnchor(node);
      const username = usernameFromAnchor(author);
      if (!username) continue;
      const text = cleanCandidateText(node, username);
      const attachments = extractAttachments(node, author);
      if (!text && !attachments.length) continue;

      const time = node.querySelector('time');
      const publishedAt = time?.getAttribute('datetime') || null;
      const permalink = commentPermalink(node);
      let originalUrl = '';
      let explicitId = '';
      if (permalink) {
        try {
          originalUrl = new URL(permalink.getAttribute('href'), location.origin).toString();
          explicitId = originalUrl;
        } catch {
          // If Instagram exposes no true comment permalink, do not pretend the Reel URL is the comment URL.
        }
      }

      const attachmentIdentity = attachments
        .map((item) => `${item.type}:${stableMediaIdentity(item.url || item.previewUrl)}`)
        .join('|');
      const platformCommentId = explicitId || simpleHash(`${username}\n${publishedAt || ''}\n${text}\n${attachmentIdentity}`);
      if (seen.has(platformCommentId)) continue;
      seen.add(platformCommentId);

      const stats = extractStats(node);
      const avatar = author?.querySelector('img[src]');
      output.push({
        id: `instagram:${platformCommentId}`,
        sourceId,
        platformCommentId,
        parentCommentId: null,
        authorName: username,
        authorUsername: `@${username}`,
        authorAvatar: avatar?.src || '',
        text,
        attachments,
        attachmentScope: 'comment',
        attachmentParserVersion: 3,
        publishedAt,
        likeCount: stats.likeCount,
        replyCount: stats.replyCount,
        originalUrl,
      });
    }
    return output;
  }

  function mergeComments(target, comments) {
    let added = 0;
    for (const comment of comments) {
      if (!target.has(comment.id)) added += 1;
      target.set(comment.id, comment);
    }
    return added;
  }

  function mergeAndStream(target, comments, sourceId, passId, streamedIds, meta = {}) {
    mergeComments(target, comments);
    const fresh = [];
    for (const comment of comments) {
      if (streamedIds.has(comment.id)) continue;
      streamedIds.add(comment.id);
      fresh.push(comment);
    }
    if (fresh.length) streamComments(sourceId, passId, fresh, meta);
    return fresh.length;
  }

  function buttonText(button) {
    return [button.innerText, button.getAttribute('aria-label'), button.querySelector('[aria-label]')?.getAttribute('aria-label')]
      .filter(Boolean).join(' ').trim();
  }

  function moreButtons() {
    const patterns = [
      /view (?:all )?.*comments?/i,
      /load more comments/i,
      /view more comments/i,
      /view (?:all )?.*repl(?:y|ies)/i,
      /показать (?:все )?.*комментар/i,
      /посмотреть (?:все )?.*комментар/i,
      /загрузить еще комментар/i,
      /загрузить ещё комментар/i,
      /посмотреть (?:все )?.*ответ/i,
      /показать (?:все )?.*ответ/i,
    ];
    const root = commentsDialog() || document;
    return [...new Set(root.querySelectorAll('button, [role="button"]'))]
      .filter((button) => isVisible(button) && patterns.some((pattern) => pattern.test(buttonText(button))))
      .sort((a, b) => {
        const aReplies = /repl|ответ/i.test(buttonText(a)) ? 1 : 0;
        const bReplies = /repl|ответ/i.test(buttonText(b)) ? 1 : 0;
        return aReplies - bReplies;
      });
  }

  function commentScroller() {
    const root = commentsDialog();
    if (!root) return null;
    const candidates = [root, ...root.querySelectorAll('div, ul')]
      .filter((node) => {
        if (!isVisible(node)) return false;
        const style = getComputedStyle(node);
        return /(auto|scroll)/.test(style.overflowY || '') && node.scrollHeight > node.clientHeight + 60;
      })
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    return candidates[0] || null;
  }

  function pageDownScroller(scroller) {
    if (!scroller) return false;
    const before = scroller.scrollTop;
    const hadTabIndex = scroller.hasAttribute('tabindex');
    const oldTabIndex = scroller.getAttribute('tabindex');
    try {
      if (!hadTabIndex) scroller.setAttribute('tabindex', '-1');
      scroller.focus({ preventScroll: true });
      scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', code: 'PageDown', keyCode: 34, which: 34, bubbles: true }));
      scroller.scrollBy({ top: Math.max(320, scroller.clientHeight * 0.92), behavior: 'auto' });
      scroller.dispatchEvent(new KeyboardEvent('keyup', { key: 'PageDown', code: 'PageDown', keyCode: 34, which: 34, bubbles: true }));
    } catch {
      scroller.scrollTop = Math.min(scroller.scrollHeight, before + Math.max(320, scroller.clientHeight * 0.92));
    } finally {
      if (!hadTabIndex) scroller.removeAttribute('tabindex');
      else if (oldTabIndex !== null) scroller.setAttribute('tabindex', oldTabIndex);
    }
    return Math.abs(scroller.scrollTop - before) > 2;
  }

  async function waitForInitialComments(url, sourceId, accumulator, streamedIds, passId, timeoutMs = 18000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isLoggedOut()) throw new Error('Instagram is not logged in in this Chrome profile. Log in to Instagram and try again.');
      mergeAndStream(accumulator, collect(url, sourceId), sourceId, passId, streamedIds, { phase: 'waiting-comments' });
      reportProgress(sourceId, {
        passId,
        phase: accumulator.size > 0 ? 'collecting' : 'waiting-comments',
        collected: accumulator.size,
        streamed: streamedIds.size,
      }, accumulator.size > 0);
      if (accumulator.size > 0 || moreButtons().length > 0) return;
      if (isReelPage() && !commentsPanelOpen()) await openReelCommentsIfNeeded(2500);
      await sleep(500);
    }
  }

  async function loadAndCollect(url, sourceId, maxClicks, requestedPassId = '') {
    if (isLoggedOut()) throw new Error('Instagram is not logged in in this Chrome profile. Log in to Instagram and try again.');

    const passId = String(requestedPassId || `${sourceId || 'instagram'}:${Date.now()}`);
    const streamedIds = new Set();
    reportProgress(sourceId, { passId, phase: 'opening-comments', collected: 0, streamed: 0 }, true);
    const reelPanel = await openReelCommentsIfNeeded();
    const accumulator = new Map();
    await waitForInitialComments(url, sourceId, accumulator, streamedIds, passId);

    let clicks = 0;
    let scrollMoves = 0;
    let pageDowns = 0;
    let manualScrollMoves = 0;
    let stableRounds = 0;
    let previousSize = accumulator.size;
    let lastKnownScrollTop = commentScroller()?.scrollTop ?? null;
    const maxSteps = Math.max(60, Math.min(720, maxClicks * 3));
    const stableLimit = Math.min(36, Math.max(8, 7 + Math.floor(maxClicks / 8)));
    const deepMode = maxClicks > 40;
    let steps = 0;

    reportProgress(sourceId, {
      passId,
      phase: 'collecting',
      collected: accumulator.size,
      streamed: streamedIds.size,
      clicks,
      scrollMoves,
      pageDowns,
      manualScrollMoves,
      step: 0,
      maxSteps,
      stableRounds,
      stableLimit,
    }, true);

    for (; steps < maxSteps && stableRounds < stableLimit; steps += 1) {
      if (isLoggedOut()) break;
      if (isReelPage() && !commentsPanelOpen()) await openReelCommentsIfNeeded(3500);

      mergeAndStream(accumulator, collect(url, sourceId), sourceId, passId, streamedIds, { phase: 'checking', step: steps + 1 });
      const sizeAtStepStart = accumulator.size;
      let progressed = accumulator.size > previousSize;
      previousSize = accumulator.size;
      let phase = 'checking';

      const buttons = moreButtons();
      if (buttons.length && clicks < maxClicks) {
        try {
          phase = 'expanding';
          buttons[0].scrollIntoView({ block: 'center', inline: 'nearest' });
          await sleep(120);
          buttons[0].click();
          clicks += 1;
          progressed = true;
          const afterButtonScroller = commentScroller();
          if (afterButtonScroller) lastKnownScrollTop = afterButtonScroller.scrollTop;
          reportProgress(sourceId, {
            passId,
            phase,
            collected: accumulator.size,
            streamed: streamedIds.size,
            clicks,
            scrollMoves,
            pageDowns,
            manualScrollMoves,
            step: steps + 1,
            maxSteps,
            stableRounds,
            stableLimit,
          }, true);
          await sleep(deepMode ? 700 : 850);
          mergeAndStream(accumulator, collect(url, sourceId), sourceId, passId, streamedIds, { phase, step: steps + 1 });
        } catch {
          phase = 'scrolling';
        }
      } else {
        const scroller = commentScroller();
        if (scroller) {
          const before = scroller.scrollTop;
          if (lastKnownScrollTop !== null && Math.abs(before - lastKnownScrollTop) > 24) {
            manualScrollMoves += 1;
            mergeAndStream(accumulator, collect(url, sourceId), sourceId, passId, streamedIds, { phase: 'manual-scroll', step: steps + 1 });
          }

          const beforeHeight = scroller.scrollHeight;
          const usePageDown = (steps + 1) % 7 === 0;
          if (usePageDown) {
            phase = 'page-down';
            if (pageDownScroller(scroller)) {
              pageDowns += 1;
              scrollMoves += 1;
              progressed = true;
            }
          } else {
            phase = 'scrolling';
            const multiplier = deepMode ? 1.2 : 0.82;
            scroller.scrollTop = Math.min(scroller.scrollHeight, before + Math.max(320, scroller.clientHeight * multiplier));
          }

          await sleep(deepMode ? 650 : 850);
          const moved = Math.abs(scroller.scrollTop - before) > 2 || scroller.scrollHeight > beforeHeight;
          if (!usePageDown && moved) {
            scrollMoves += 1;
            progressed = true;
          } else if (!moved && deepMode) {
            phase = 'waiting-more';
            await sleep(750);
          }
          lastKnownScrollTop = scroller.scrollTop;
          mergeAndStream(accumulator, collect(url, sourceId), sourceId, passId, streamedIds, { phase, step: steps + 1 });
        } else {
          phase = 'waiting-panel';
          await sleep(deepMode ? 900 : 650);
        }
      }

      if (accumulator.size > previousSize) progressed = true;
      previousSize = accumulator.size;
      stableRounds = progressed ? 0 : stableRounds + 1;

      reportProgress(sourceId, {
        passId,
        phase,
        collected: accumulator.size,
        streamed: streamedIds.size,
        clicks,
        scrollMoves,
        pageDowns,
        manualScrollMoves,
        step: steps + 1,
        maxSteps,
        stableRounds,
        stableLimit,
      }, accumulator.size !== sizeAtStepStart);
    }

    mergeAndStream(accumulator, collect(url, sourceId), sourceId, passId, streamedIds, { phase: 'complete', step: steps });
    const comments = [...accumulator.values()];
    const scroller = commentScroller();
    const attachmentCount = comments.reduce((sum, comment) => sum + (Array.isArray(comment.attachments) ? comment.attachments.length : 0), 0);
    const diagnostics = {
      commentCandidates: commentNodes().length,
      permalinkAnchors: document.querySelectorAll('a[href*="/c/"], a[href*="comment_id="]').length,
      timestamps: document.querySelectorAll('time').length,
      parsedComments: comments.length,
      attachmentCount,
      streamedComments: streamedIds.size,
      loadButtons: moreButtons().length,
      loggedOut: isLoggedOut(),
      reelPage: reelPanel.reelPage,
      commentsPanelClickAttempted: reelPanel.clickAttempted,
      commentsPanelOpen: commentsPanelOpen(),
      scrollMoves,
      pageDowns,
      manualScrollMoves,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      scrollHeight: scroller ? scroller.scrollHeight : null,
      clientHeight: scroller ? scroller.clientHeight : null,
      maxClicks,
      maxSteps,
      steps,
      stableRounds,
      stableLimit,
      stoppedBy: steps >= maxSteps ? 'step-limit' : stableRounds >= stableLimit ? 'stable' : 'other',
    };

    reportProgress(sourceId, {
      passId,
      phase: 'complete',
      collected: comments.length,
      streamed: streamedIds.size,
      clicks,
      scrollMoves,
      pageDowns,
      manualScrollMoves,
      step: steps,
      maxSteps,
      stableRounds,
      stableLimit,
    }, true);

    return {
      comments,
      clicks,
      passId,
      pageUrl: location.href,
      diagnostics,
      note: 'Attachments are read only from the nearest verified comment DOM container. Empty media values are never resolved against the Reel URL; GIF/image/video URLs are streamed only when a real media URL exists.',
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CC_INSTAGRAM_COLLECT') return false;
    loadAndCollect(
      message.url || location.href,
      message.sourceId,
      Math.max(1, Number(message.maxClicks || 40)),
      message.passId || '',
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
