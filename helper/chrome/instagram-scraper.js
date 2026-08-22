(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function simpleHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function isLoggedOut() {
    return location.pathname.includes('/accounts/login') || Boolean(document.querySelector('input[name="username"], input[name="password"]'));
  }

  function profileAnchor(node) {
    return [...node.querySelectorAll('a[href]')].find((anchor) => {
      const href = anchor.getAttribute('href') || '';
      return /^\/[A-Za-z0-9._]+\/$/.test(href) && !href.startsWith('/explore/') && !href.startsWith('/accounts/');
    }) || null;
  }

  function cleanCandidateText(node, username) {
    const uiText = /^(reply|like|likes|see translation|view replies|view \d+ replies|load more comments|more|ответить|нравится|отметок «нравится»|посмотреть ответы|показать ответы|показать ещё комментарии|загрузить еще комментарии)$/i;
    const values = [...node.querySelectorAll('span')]
      .map((span) => (span.innerText || span.textContent || '').trim())
      .filter(Boolean)
      .filter((text) => text !== username && !uiText.test(text));

    const unique = [...new Set(values)];
    const likely = unique.filter((text) => text.length > 1 && !/^\d+[smhdw]$/i.test(text));
    if (likely.length) return likely.sort((a, b) => b.length - a.length)[0];

    const lines = (node.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
    return lines.find((line) => line !== username && !uiText.test(line)) || '';
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
    const likesMatch = text.match(/([\d.,\s]+\s*[kKmMкКмМ]?)\s+(?:likes?|отмет(?:ка|ки|ок)\s+«?нравится»?)/i);
    const repliesMatch = text.match(/(?:view|show|посмотреть|показать)\s+([\d.,\s]+)\s+(?:repl(?:y|ies)|ответ)/i);
    return {
      likeCount: likesMatch ? parseNumber(likesMatch[1]) : 0,
      replyCount: repliesMatch ? parseNumber(repliesMatch[1]) : 0,
    };
  }

  function commentNodes() {
    const roots = [document.querySelector('[role="dialog"]'), document.querySelector('article'), document.body].filter(Boolean);
    const seen = new Set();
    const nodes = [];
    for (const root of roots) {
      for (const node of root.querySelectorAll('ul li')) {
        if (seen.has(node)) continue;
        seen.add(node);
        if (!profileAnchor(node)) continue;
        nodes.push(node);
      }
    }
    return nodes;
  }

  function collect(url, sourceId) {
    const output = [];
    const seen = new Set();

    for (const node of commentNodes()) {
      const authorLink = profileAnchor(node);
      if (!authorLink) continue;
      const username = (authorLink.getAttribute('href') || '').split('/').filter(Boolean)[0] || (authorLink.textContent || '').trim();
      if (!username) continue;

      const text = cleanCandidateText(node, username);
      if (!text || text.length < 2) continue;

      const time = node.querySelector('time');
      const publishedAt = time?.getAttribute('datetime') || null;
      const permalink = [...node.querySelectorAll('a[href]')].find((anchor) => /\/c\/|comment_id=/i.test(anchor.getAttribute('href') || ''));
      let originalUrl = url;
      let explicitId = '';
      if (permalink) {
        try {
          originalUrl = new URL(permalink.getAttribute('href'), location.origin).toString();
          explicitId = originalUrl;
        } catch { /* use source URL */ }
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

  function moreButtons() {
    const patterns = [
      /view .*comments?/i,
      /load more comments/i,
      /view .*repl(?:y|ies)/i,
      /показать .*комментар/i,
      /загрузить еще комментар/i,
      /посмотреть .*ответ/i,
      /показать .*ответ/i,
    ];

    return [...document.querySelectorAll('button, [role="button"]')].filter((button) => {
      const text = (button.innerText || button.getAttribute('aria-label') || '').trim();
      return text && patterns.some((pattern) => pattern.test(text));
    });
  }

  async function loadAndCollect(url, sourceId, maxClicks) {
    if (isLoggedOut()) throw new Error('Instagram is not logged in in this Chrome profile. Log in to Instagram and try again.');

    let previousCount = 0;
    let stableRounds = 0;
    let clicks = 0;

    while (clicks < maxClicks && stableRounds < 3) {
      const current = collect(url, sourceId);
      if (current.length === previousCount) stableRounds += 1;
      else stableRounds = 0;
      previousCount = current.length;

      const buttons = moreButtons();
      if (!buttons.length) break;
      const button = buttons[0];
      try {
        button.scrollIntoView({ block: 'center' });
        button.click();
        clicks += 1;
        await sleep(850);
      } catch {
        break;
      }
    }

    await sleep(300);
    const comments = collect(url, sourceId);
    return {
      comments,
      clicks,
      pageUrl: location.href,
      note: 'Instagram DOM is private implementation detail and may require selector updates after Instagram UI changes.',
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
