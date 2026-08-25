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

  function isReelPage() {
    return /^\/reels?\//i.test(location.pathname);
  }

  function commentsPanelOpen() {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    for (const dialog of dialogs) {
      const headingText = [...dialog.querySelectorAll('h1, h2, h3, [role="heading"]')]
        .map((node) => (node.textContent || '').trim())
        .join(' ');
      if (/comments?|комментар/i.test(headingText)) return true;

      const field = dialog.querySelector('textarea, input[placeholder]');
      const placeholder = field?.getAttribute('placeholder') || '';
      if (/comment|комментар/i.test(placeholder)) return true;
    }

    return [...document.querySelectorAll('textarea, input[placeholder]')].some((field) => {
      const placeholder = field.getAttribute('placeholder') || '';
      if (!/comment|комментар/i.test(placeholder)) return false;
      const rect = field.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function visibleClickable(node) {
    const clickable = node?.closest?.('button, [role="button"], a[href]');
    if (!clickable) return null;
    const rect = clickable.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const style = getComputedStyle(clickable);
    if (style.visibility === 'hidden' || style.display === 'none') return null;
    return clickable;
  }

  function commentActionButton() {
    const candidates = [];
    const seen = new Set();
    const push = (node) => {
      const clickable = visibleClickable(node);
      if (!clickable || seen.has(clickable)) return;
      seen.add(clickable);
      candidates.push(clickable);
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

    document.querySelectorAll('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      if (/\/comments?\/?(?:[?#]|$)/i.test(href)) push(anchor);
    });

    return candidates[0] || null;
  }

  async function openReelCommentsIfNeeded(timeoutMs = 7000) {
    if (!isReelPage()) {
      return { reelPage: false, clickAttempted: false, opened: commentsPanelOpen() };
    }

    if (commentsPanelOpen()) {
      return { reelPage: true, clickAttempted: false, opened: true };
    }

    const deadline = Date.now() + timeoutMs;
    let clickAttempted = false;

    while (Date.now() < deadline) {
      if (commentsPanelOpen()) return { reelPage: true, clickAttempted, opened: true };

      const action = commentActionButton();
      if (action) {
        clickAttempted = true;
        try {
          action.scrollIntoView({ block: 'center', inline: 'nearest' });
          await sleep(120);
          action.click();
          await sleep(900);
          if (commentsPanelOpen()) return { reelPage: true, clickAttempted, opened: true };
        } catch {
          // Instagram can replace the action element while the Reel UI settles.
          // Keep looking until the timeout rather than failing immediately.
        }
      }

      await sleep(350);
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
    if (!anchor) return '';
    return (anchor.getAttribute('href') || '').split('?')[0].split('/').filter(Boolean)[0]
      || (anchor.textContent || '').trim();
  }

  function isUiText(text, username = '') {
    const value = String(text || '').trim();
    if (!value || value === username || value === `@${username}`) return true;
    return /^(reply|replies|like|likes|see translation|edited|more|view replies|view \d+ replies|view all \d+ replies|load more comments|view more comments|view all \d+ comments|\d+[smhdw]|\d+\s*(seconds?|minutes?|hours?|days?|weeks?)\s*ago|ответить|ответы|нравится|отметок? «?нравится»?|показать перевод|изменено|ещ[её]|посмотреть ответы|показать ответы|показать все ответы|показать ещё комментарии|загрузить еще комментарии|посмотреть все комментарии)$/i.test(value);
  }

  function cleanCandidateText(node, username) {
    const leafSpans = [...node.querySelectorAll('span')]
      .filter((span) => !span.querySelector('span'))
      .map((span) => (span.innerText || span.textContent || '').trim())
      .filter((text) => text.length > 1 && !isUiText(text, username));

    const uniqueLeaf = [...new Set(leafSpans)];
    const usefulLeaf = uniqueLeaf.filter((text) => {
      if (/^[\d.,\s]+[kKmMкКмМ]?\s*(likes?|отмет)/i.test(text)) return false;
      if (/^(view|show|посмотреть|показать)\s+\d+/i.test(text)) return false;
      return true;
    });
    if (usefulLeaf.length) return usefulLeaf.sort((a, b) => b.length - a.length)[0];

    const lines = (node.innerText || '')
      .split('\n')
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
    const likesMatch = text.match(/([\d.,\s]+\s*[kKmMкКмМ]?)\s+(?:likes?|отмет(?:ка|ки|ок)\s+«?нравится»?)/i);
    const repliesMatch = text.match(/(?:view|show|посмотреть|показать)\s+([\d.,\s]+)\s+(?:repl(?:y|ies)|ответ)/i);
    return {
      likeCount: likesMatch ? parseNumber(likesMatch[1]) : 0,
      replyCount: repliesMatch ? parseNumber(repliesMatch[1]) : 0,
    };
  }

  function commentPermalink(node) {
    return [...node.querySelectorAll('a[href]')].find((anchor) => {
      const href = anchor.getAttribute('href') || '';
      return /\/c\/|[?&]comment_id=/i.test(href);
    }) || null;
  }

  function candidateScore(node) {
    if (!node) return Infinity;
    const authorLink = profileAnchor(node);
    if (!authorLink) return Infinity;
    const username = usernameFromAnchor(authorLink);
    if (!username) return Infinity;

    const textLength = (node.innerText || '').trim().length;
    if (textLength < 2 || textLength > 2500) return Infinity;

    const hasTime = Boolean(node.querySelector('time'));
    const hasPermalink = Boolean(commentPermalink(node));
    if (!hasTime && !hasPermalink) return Infinity;

    const text = cleanCandidateText(node, username);
    if (!text || text.length < 2) return Infinity;

    const profiles = node.querySelectorAll('a[href^="/"]').length;
    if (profiles > 8) return Infinity;

    return textLength + profiles * 350 - (hasPermalink ? 180 : 0);
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

  function expandForCommentText(node, username) {
    let current = node;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      const rawLength = (current.innerText || '').trim().length;
      if (rawLength > 3500) break;
      const profiles = current.querySelectorAll('a[href^="/"]').length;
      if (profiles > 10) break;
      const text = cleanCandidateText(current, username);
      if (text && text.length >= 2) return { node: current, text };
    }
    return { node, text: '' };
  }

  function commentNodes() {
    const roots = [
      document.querySelector('[role="dialog"]'),
      document.querySelector('main article'),
      document.querySelector('article'),
      document.querySelector('main'),
      document.body,
    ].filter(Boolean);

    const seen = new Set();
    const nodes = [];
    const push = (node) => {
      if (!node || seen.has(node) || !profileAnchor(node)) return;
      seen.add(node);
      nodes.push(node);
    };

    for (const root of roots) {
      root.querySelectorAll('ul li').forEach(push);

      root.querySelectorAll('a[href*="/c/"], a[href*="comment_id="]').forEach((anchor) => {
        push(nearestCommentContainer(anchor, root));
      });
      root.querySelectorAll('time').forEach((time) => {
        push(nearestCommentContainer(time, root));
      });
    }

    return nodes;
  }

  function collect(url, sourceId) {
    const output = [];
    const seen = new Set();

    for (const initialNode of commentNodes()) {
      const authorLink = profileAnchor(initialNode);
      if (!authorLink) continue;
      const username = usernameFromAnchor(authorLink);
      if (!username) continue;

      const expanded = expandForCommentText(initialNode, username);
      const node = expanded.node;
      const text = expanded.text;
      if (!text || text.length < 2) continue;

      const time = node.querySelector('time') || initialNode.querySelector('time');
      const publishedAt = time?.getAttribute('datetime') || null;
      const permalink = commentPermalink(node) || commentPermalink(initialNode);
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

    const candidates = new Set(document.querySelectorAll('button, [role="button"]'));
    document.querySelectorAll('[aria-label]').forEach((node) => {
      const clickable = node.closest('button, [role="button"]');
      if (clickable) candidates.add(clickable);
    });

    return [...candidates].filter((button) => {
      const text = [
        button.innerText,
        button.getAttribute('aria-label'),
        button.querySelector('[aria-label]')?.getAttribute('aria-label'),
      ].filter(Boolean).join(' ').trim();
      if (!text || !patterns.some((pattern) => pattern.test(text))) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  async function waitForInitialComments(url, sourceId, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    let best = [];
    while (Date.now() < deadline) {
      if (isLoggedOut()) throw new Error('Instagram is not logged in in this Chrome profile. Log in to Instagram and try again.');
      const current = collect(url, sourceId);
      if (current.length > best.length) best = current;
      if (current.length > 0 || moreButtons().length > 0) return best;
      await sleep(500);
    }
    return best;
  }

  async function loadAndCollect(url, sourceId, maxClicks) {
    if (isLoggedOut()) throw new Error('Instagram is not logged in in this Chrome profile. Log in to Instagram and try again.');

    const reelPanel = await openReelCommentsIfNeeded();
    await waitForInitialComments(url, sourceId);

    let previousCount = -1;
    let stableRounds = 0;
    let clicks = 0;

    while (clicks < maxClicks && stableRounds < 4) {
      const current = collect(url, sourceId);
      if (current.length === previousCount) stableRounds += 1;
      else stableRounds = 0;
      previousCount = current.length;

      const buttons = moreButtons();
      if (!buttons.length) {
        await sleep(650);
        if (!moreButtons().length) break;
        continue;
      }

      const button = buttons[0];
      try {
        button.scrollIntoView({ block: 'center' });
        await sleep(120);
        button.click();
        clicks += 1;
        await sleep(1000);
      } catch {
        break;
      }
    }

    await sleep(500);
    const comments = collect(url, sourceId);
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
    };

    return {
      comments,
      clicks,
      pageUrl: location.href,
      diagnostics,
      note: 'Instagram DOM is a private implementation detail and may require selector updates after Instagram UI changes.',
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