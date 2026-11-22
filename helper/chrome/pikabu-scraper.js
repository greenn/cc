(() => {
  if (window.__CC_PIKABU_SCRAPER_INSTALLED__) return;
  window.__CC_PIKABU_SCRAPER_INSTALLED__ = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let collecting = false;

  function isVisible(node) {
    if (!(node instanceof Element) || !node.isConnected || node.closest('[hidden]')) return false;
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none'
      && node.getClientRects().length > 0;
  }

  function safeText(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll('script, style, .comment__children, .comment__footer, .comment__actions, .comment__rating, .comment__emotions, .comment-toggle-children, .comment').forEach((item) => item.remove());
    clone.querySelectorAll('br').forEach((item) => item.replaceWith('\n'));
    clone.querySelectorAll('p, li, blockquote').forEach((item) => item.append('\n'));
    return (clone.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function sameStory() {
    const match = location.pathname.match(/^\/story\/(?:[^/]*?_)?(\d+)(?:\/)?$/i);
    return match?.[1] || '';
  }

  function commentId(node) {
    const body = node.querySelector(':scope > .comment__body');
    const permalink = node.getAttribute('data-copy-url')
      || body?.querySelector('.comment__tool[data-role="link"]')?.getAttribute('href')
      || '';
    const raw = [
      node.id, node.getAttribute('data-id'), node.getAttribute('data-comment-id'),
      node.getAttribute('data-comment'), permalink,
    ].filter(Boolean);
    for (const item of raw) {
      if (/^\d{3,}$/.test(item)) return item;
      const match = item.match(/(?:comment[_/-]|[?&#](?:cid|comment|comment_id|c)=)(\d{3,})/i);
      if (match) return match[1];
    }
    return '';
  }

  function safePikabuUrl(value) {
    try {
      const url = new URL(value, location.origin);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      if (url.hostname !== 'pikabu.ru' && url.hostname !== 'www.pikabu.ru') return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function normalizeDate(node) {
    if (!node) return null;
    const raw = node.getAttribute('datetime') || node.dataset.timestamp
      || node.dataset.time || node.getAttribute('title') || '';
    if (/^\d{10,13}$/.test(raw)) {
      const number = Number(raw);
      return new Date(raw.length === 10 ? number * 1000 : number).toISOString();
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return null;
  }

  function parseCount(text) {
    const normalized = String(text || '').replace(/[\s\u00a0]/g, '');
    const match = normalized.match(/[-+]?\d+(?:[,.]\d+)?(?:[kкmм])?/i);
    if (!match) return 0;
    const raw = match[0].toLowerCase();
    const base = Number.parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(base)) return 0;
    return Math.round(base * (/[kк]$/.test(raw) ? 1000 : /[mм]$/.test(raw) ? 1000000 : 1));
  }

  function postMeta() {
    const title = safeText(document.querySelector('.story__title, .story__title-link, h1'))
      || document.querySelector('meta[property="og:title"]')?.content || document.title || '';
    const author = safeText(document.querySelector('.story__user-name, .story__user a, .story__author a'))
      || 'Pikabu';
    const counter = document.querySelector('.comments__count, .story__comments-count, .story__comments-link');
    const number = counter?.textContent?.match(/(\d[\d\s\u00a0]*)/);
    return {
      title: title.replace(/\s*[|—-]\s*Пикабу\s*$/i, '').trim(),
      author,
      expectedCount: number ? Math.max(0, Number(number[1].replace(/\s|\u00a0/g, ''))) : null,
    };
  }

  function commentNodes() {
    return [...document.querySelectorAll('.comment')]
      .filter((node) => node.querySelector(':scope > .comment__body, :scope > .comment__content'));
  }

  function parseComment(node, sourceId, storyId) {
    const id = commentId(node);
    if (!id) return null;
    const body = node.querySelector(':scope > .comment__body') || node;
    const content = body.querySelector('.comment__content');
    const text = safeText(content);
    const images = [...(content?.querySelectorAll('img') || [])]
      .map((img) => safePikabuUrl(img.currentSrc || img.getAttribute('src') || ''))
      .filter(Boolean);
    const textWithMedia = [text, ...images.map((url) => '[Изображение] ' + url)].filter(Boolean).join('\n');
    if (!textWithMedia) return null;

    const user = body.querySelector('.comment__user a[href], a.comment__user[href], .comment__user')
      || body.querySelector('.comment__header a[href*="/@"]');
    const authorName = safeText(user) || 'Аноним';
    const userLink = user?.closest('a[href]') || user?.querySelector?.('a[href]');
    const avatar = body.querySelector('.comment__avatar img, .comment__user-avatar img, img.comment__avatar');
    const parentNode = node.parentElement?.closest('.comment');
    const parentId = parentNode ? commentId(parentNode) : '';
    const originalUrl = safePikabuUrl(node.getAttribute('data-copy-url'))
      || safePikabuUrl(body.querySelector('a.comment__tool[data-role="link"]')?.getAttribute('href'))
      || location.origin + location.pathname + '#comment_' + id;

    return {
      id: 'pikabu:' + storyId + ':' + id,
      sourceId,
      platformCommentId: id,
      parentCommentId: parentId || null,
      authorName,
      authorUsername: userLink?.pathname?.startsWith('/@') ? decodeURIComponent(userLink.pathname) : '',
      authorAvatar: safePikabuUrl(avatar?.currentSrc || avatar?.getAttribute('src')),
      text: textWithMedia,
      publishedAt: normalizeDate(body.querySelector('time[datetime], .comment__date time, .comment__date, .comment__time')),
      likeCount: parseCount(body.querySelector('.comment__rating-count')?.textContent),
      replyCount: node.querySelectorAll(':scope > .comment__children > .comment').length,
      originalUrl,
    };
  }

  function progress(sourceId, passId, phase, found, clicks, step, maxSteps) {
    chrome.runtime.sendMessage({
      type: 'CC_PIKABU_PROGRESS', sourceId,
      progress: { passId, phase, collected: found, clicks, step, maxSteps, timestamp: Date.now() },
    }, () => { void chrome.runtime.lastError; });
  }

  async function stream(sourceId, passId, items) {
    for (let i = 0; i < items.length; i += 25) {
      const comments = items.slice(i, i + 25);
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'CC_PIKABU_COMMENT_BATCH', sourceId, passId,
          comments, meta: { batchSize: comments.length, timestamp: Date.now() },
        }, (response) => {
          const error = chrome.runtime.lastError;
          if (error || !response?.ok) reject(new Error(error?.message || 'Pikabu comment stream failed.'));
          else resolve();
        });
      });
    }
  }

  function canClick(node) {
    if (!isVisible(node) || node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') return false;
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        try {
          const url = new URL(href, location.href);
          if (url.pathname !== location.pathname || url.origin !== location.origin) return false;
        } catch { return false; }
      }
    }
    return true;
  }

  function expandButtons() {
    const results = [];
    const seen = new Set();
    function add(node, priority) {
      if (!node || !canClick(node) || seen.has(node)) return;
      seen.add(node);
      results.push({ node, priority });
    }

    document.querySelectorAll('.comments__more-button, [data-role="more-comments"]').forEach((node) => add(node, 0));

    document.querySelectorAll('.comment-toggle-children').forEach((node) => {
      const comment = node.closest('.comment');
      const children = comment?.querySelector(':scope > .comment__children');
      const collapsed = children?.hidden || children?.getAttribute('aria-hidden') === 'true'
        || node.getAttribute('aria-expanded') === 'false';
      if (collapsed) add(node, 1);
    });

    const section = document.querySelector('.comments, #comments, .comments-block');
    if (section) section.querySelectorAll('button, [role="button"], a[href]').forEach((node) => {
      const label = (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(?:показать|загрузить|раскрыть|ещё|еще|more|show|load).{0,48}(?:комментар|ответ|ветк|repl|comment)/i.test(label)
          || /^(?:показать|загрузить)\s+(?:ещ[её]|больше|все)$/i.test(label)) add(node, 2);
    });

    return results.sort((a, b) => a.priority - b.priority).map((item) => item.node);
  }

  async function collect(message) {
    const sourceId = String(message.sourceId || '');
    const storyId = String(message.storyId || '');
    if (!sourceId || !/^\d+$/.test(storyId) || sameStory() !== storyId) {
      throw new Error('Pikabu worker is not on the requested story.');
    }

    const passId = String(message.passId || sourceId + ':' + Date.now());
    const maxSteps = Math.min(2000, Math.max(20, Number(message.maxSteps || 800)));
    const started = Date.now();
    const deadline = started + 240000;
    const seen = new Map();
    const attempts = new WeakMap();
    let clicks = 0;
    let step = 0;
    let idle = 0;
    let reason = 'exhausted';
    const update = async () => {
      const delta = [];
      for (const node of commentNodes()) {
        const item = parseComment(node, sourceId, storyId);
        if (!item || seen.has(item.id)) continue;
        seen.set(item.id, item);
        delta.push(item);
      }
      if (delta.length) await stream(sourceId, passId, delta);
      return delta.length;
    };

    progress(sourceId, passId, 'opening', 0, 0, 0, maxSteps);
    for (let i = 0; i < 24 && !document.querySelector('.comment, .comments, #comments'); i += 1) {
      await sleep(500);
    }
    if (!document.querySelector('.comments, #comments, .comment')) {
      throw new Error('Pikabu comments section did not appear. Check access to the post.');
    }

    const initial = await update();
    if (initial) idle = 0;

    for (step = 1; step <= maxSteps; step += 1) {
      if (Date.now() >= deadline) { reason = 'timeout'; break; }
      const buttons = expandButtons().filter((node) => (attempts.get(node) || 0) < 2);
      const next = buttons[0];
      let moved = false;

      if (next) {
        attempts.set(next, (attempts.get(next) || 0) + 1);
        next.scrollIntoView({ block: 'center', behavior: 'instant' });
        await sleep(100);
        if (canClick(next)) {
          next.click();
          clicks += 1;
          moved = true;
        }
        await sleep(800);
      } else {
        const before = window.scrollY;
        window.scrollBy({ top: Math.max(500, window.innerHeight * 0.85), behavior: 'instant' });
        moved = window.scrollY !== before;
        await sleep(550);
      }

      const added = await update();
      if (added || moved && next) idle = 0;
      else idle += 1;
      if (step % 5 === 0 || added) progress(sourceId, passId, next ? 'expanding' : 'scrolling', seen.size, clicks, step, maxSteps);
      if (idle >= 6 && !expandButtons().some((node) => (attempts.get(node) || 0) < 2)) break;
    }

    if (step > maxSteps) reason = 'step-limit';
    const meta = postMeta();
    const countShortfall = meta.expectedCount != null && seen.size < meta.expectedCount;
    const complete = reason === 'exhausted' && !countShortfall;
    progress(sourceId, passId, complete ? 'complete' : 'partial', seen.size, clicks, Math.min(step, maxSteps), maxSteps);

    return {
      foundCount: seen.size,
      expectedCount: meta.expectedCount,
      title: meta.title,
      author: meta.author,
      complete,
      diagnostics: { reason: countShortfall && reason === 'exhausted' ? 'count-mismatch' : reason, steps: Math.min(step, maxSteps), clicks, elapsedMs: Date.now() - started },
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== 'CC_PIKABU_COLLECT') return false;
    if (collecting) { respond({ ok: false, error: 'Pikabu collection is already running in this tab.' }); return false; }
    collecting = true;
    collect(message).then(
      (result) => respond({ ok: true, result }),
      (error) => respond({ ok: false, error: error?.message || String(error) }),
    ).finally(() => { collecting = false; });
    return true;
  });
})();
