(() => {
  if (window.__CC_INSTAGRAM_SCRAPER_INSTALLED__) return;
  window.__CC_INSTAGRAM_SCRAPER_INSTALLED__ = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let lastProgressAt = 0;
  let lastProgressSignature = '';

  function reportProgress(sourceId, progress = {}, force = false) {
    if (!sourceId) return;
    const payload = {
      phase: String(progress.phase || 'collecting'),
      collected: Math.max(0, Number(progress.collected || 0)),
      clicks: Math.max(0, Number(progress.clicks || 0)),
      scrollMoves: Math.max(0, Number(progress.scrollMoves || 0)),
      step: Math.max(0, Number(progress.step || 0)),
      maxSteps: Math.max(0, Number(progress.maxSteps || 0)),
      stableRounds: Math.max(0, Number(progress.stableRounds || 0)),
      stableLimit: Math.max(0, Number(progress.stableLimit || 0)),
      timestamp: Date.now(),
    };
    const signature = `${payload.phase}:${payload.collected}:${payload.clicks}:${payload.scrollMoves}:${payload.step}`;
    const now = Date.now();
    if (!force && now - lastProgressAt < 280 && signature === lastProgressSignature) return;
    if (!force && now - lastProgressAt < 180) return;
    lastProgressAt = now;
    lastProgressSignature = signature;
    chrome.runtime.sendMessage({
      type: 'CC_INSTAGRAM_PROGRESS',
      sourceId,
      progress: payload,
    }, () => {
      void chrome.runtime.lastError;
    });
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

  function profileAnchor(node) {
    return [...node.querySelectorAll('a[href]')].find((anchor) => {
      const href = anchor.getAttribute('href') || '';
      return /^\/[A-Za-z0-9._]+\/?(?:\?.*)?$/.test(href)
        && !href.startsWith('/explore/')
        && !href.startsWith('/accounts/')
        && !href.startsWith('/direct/');
    }) || null;
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

  function candidateScore(node) {
    if (!node) return Infinity;
    const author = profileAnchor(node);
    const username = usernameFromAnchor(author);
    if (!username) return Infinity;
    const raw = (node.innerText || '').trim();
    if (raw.length < 2 || raw.length > 3000) return Infinity;
    if (!node.querySelector('time') && !commentPermalink(node)) return Infinity;
    if (!cleanCandidateText(node, username)) return Infinity;
    const profiles = node.querySelectorAll('a[href^="/"]').length;
    if (profiles > 10) return Infinity;
    return raw.length + profiles * 320 - (commentPermalink(node) ? 180 : 0);
  }

  function nearestCommentContainer(seed, root) {
    let node = seed?.nodeType === Node.ELEMENT_NODE ? seed : seed?.parentElement;
    let best = null;
    let bestScore = Infinity;
    for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
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
    return [
      document.querySelector('main article'),
      document.querySelector('article'),
      document.querySelector('main'),
    ].filter(Boolean);
  }

  function commentNodes() {
    const seen = new Set();
    const nodes = [];
    const push = (node) => {
      if (!node || seen.has(node) || !profileAnchor(node)) return;
      seen.add(node);
      nodes.push(node);
    };

    for (const root of commentRoots()) {
      root.querySelectorAll('ul li').forEach(push);
      root.querySelectorAll('a[href*="/c/"], a[href*="comment_id="]').forEach((anchor) => push(nearestCommentContainer(anchor, root)));
      root.querySelectorAll('time').forEach((time) => push(nearestCommentContainer(time, root)));
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
      if (!text || text.length < 2) continue;
      const time = node.querySelector('time');
      const publishedAt = time?.getAttribute('datetime') || null;
      const permalink = commentPermalink(node);
      let originalUrl = url;
      let explicitId = '';
      if (permalink) {
        try {
          originalUrl = new URL(permalink.getAttribute('href'), location.origin).toString();
          explicitId = originalUrl;
        } catch { /* keep source URL */ }
      }
      const platformCommentId = explicitId || simpleHash(`${username}\n${publishedAt || ''}\n${text}`);
      if (seen.has(platformCommentId)) continue;
      seen.add(platformCommentId);
      const stats = extractStats(node);
      const avatar = node.querySelector('img[src]');
      output.push({
        id: `instagram:${platformCommentId}`,
        sourceId,
        platformCommentId,
        parentCommentId: null,
        authorName: username,
        authorUsername: `@${username}`,
        authorAvatar: avatar?.src || '',
        text,
        publishedAt,
        likeCount: stats.likeCount,
        replyCount: stats.replyCount,
        originalUrl,
      });
    }
    return output;
  }

  function mergeComments(target, comments) {
    for (const comment of comments) target.set(comment.id, comment);
    return target.size;
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

  async function waitForInitialComments(url, sourceId, accumulator, timeoutMs = 18000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isLoggedOut()) throw new Error('Instagram is not logged in in this Chrome profile. Log in to Instagram and try again.');
      mergeComments(accumulator, collect(url, sourceId));
      reportProgress(sourceId, {
        phase: accumulator.size > 0 ? 'collecting' : 'waiting-comments',
        collected: accumulator.size,
      }, accumulator.size > 0);
      if (accumulator.size > 0 || moreButtons().length > 0) return;
      if (isReelPage() && !commentsPanelOpen()) await openReelCommentsIfNeeded(2500);
      await sleep(500);
    }
  }

  async function loadAndCollect(url, sourceId, maxClicks) {
    if (isLoggedOut()) throw new Error('Instagram is not logged in in this Chrome profile. Log in to Instagram and try again.');

    reportProgress(sourceId, { phase: 'opening-comments', collected: 0 }, true);
    const reelPanel = await openReelCommentsIfNeeded();
    const accumulator = new Map();
    await waitForInitialComments(url, sourceId, accumulator);

    let clicks = 0;
    let scrollMoves = 0;
    let stableRounds = 0;
    let previousSize = accumulator.size;
    const maxSteps = Math.max(60, Math.min(720, maxClicks * 3));
    const stableLimit = Math.min(36, Math.max(8, 7 + Math.floor(maxClicks / 8)));
    const deepMode = maxClicks > 40;
    let steps = 0;

    reportProgress(sourceId, {
      phase: 'collecting',
      collected: accumulator.size,
      clicks,
      scrollMoves,
      step: 0,
      maxSteps,
      stableRounds,
      stableLimit,
    }, true);

    for (; steps < maxSteps && stableRounds < stableLimit; steps += 1) {
      if (isLoggedOut()) break;
      if (isReelPage() && !commentsPanelOpen()) await openReelCommentsIfNeeded(3500);

      mergeComments(accumulator, collect(url, sourceId));
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
          reportProgress(sourceId, {
            phase,
            collected: accumulator.size,
            clicks,
            scrollMoves,
            step: steps + 1,
            maxSteps,
            stableRounds,
            stableLimit,
          }, true);
          await sleep(deepMode ? 700 : 850);
          mergeComments(accumulator, collect(url, sourceId));
        } catch {
          phase = 'scrolling';
        }
      } else {
        const scroller = commentScroller();
        if (scroller) {
          phase = 'scrolling';
          const before = scroller.scrollTop;
          const beforeHeight = scroller.scrollHeight;
          const multiplier = deepMode ? 1.2 : 0.82;
          scroller.scrollTop = Math.min(scroller.scrollHeight, before + Math.max(320, scroller.clientHeight * multiplier));
          await sleep(deepMode ? 650 : 850);
          const moved = Math.abs(scroller.scrollTop - before) > 2 || scroller.scrollHeight > beforeHeight;
          if (moved) {
            scrollMoves += 1;
            progressed = true;
          } else if (deepMode) {
            phase = 'waiting-more';
            // At a temporary bottom Instagram can still append another chunk a
            // moment later. Give deep-load passes a little more time before
            // deciding that the list is stable.
            await sleep(750);
          }
          mergeComments(accumulator, collect(url, sourceId));
        } else {
          phase = 'waiting-panel';
          await sleep(deepMode ? 900 : 650);
        }
      }

      if (accumulator.size > previousSize) progressed = true;
      previousSize = accumulator.size;
      stableRounds = progressed ? 0 : stableRounds + 1;

      reportProgress(sourceId, {
        phase,
        collected: accumulator.size,
        clicks,
        scrollMoves,
        step: steps + 1,
        maxSteps,
        stableRounds,
        stableLimit,
      }, accumulator.size !== sizeAtStepStart);
    }

    mergeComments(accumulator, collect(url, sourceId));
    const comments = [...accumulator.values()];
    const scroller = commentScroller();
    const diagnostics = {
      commentCandidates: commentNodes().length,
      permalinkAnchors: document.querySelectorAll('a[href*="/c/"], a[href*="comment_id="]').length,
      timestamps: document.querySelectorAll('time').length,
      parsedComments: comments.length,
      loadButtons: moreButtons().length,
      loggedOut: isLoggedOut(),
      reelPage: reelPanel.reelPage,
      commentsPanelClickAttempted: reelPanel.clickAttempted,
      commentsPanelOpen: commentsPanelOpen(),
      scrollMoves,
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
      phase: 'complete',
      collected: comments.length,
      clicks,
      scrollMoves,
      step: steps,
      maxSteps,
      stableRounds,
      stableLimit,
    }, true);

    return {
      comments,
      clicks,
      pageUrl: location.href,
      diagnostics,
      note: 'Instagram DOM is private and can change; deeper CC passes revisit the temporary Reel page with a larger crawl budget and merge newly discovered comments locally.',
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CC_INSTAGRAM_COLLECT') return false;
    loadAndCollect(message.url || location.href, message.sourceId, Math.max(1, Number(message.maxClicks || 40)))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
