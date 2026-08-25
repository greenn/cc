(() => {
  if (window.__CC_INSTAGRAM_DOM_PRUNER_INSTALLED__) return;
  window.__CC_INSTAGRAM_DOM_PRUNER_INSTALLED__ = true;

  const PRUNE_AFTER_COLLECTED = 100;
  const KEEP_LIVE_COMMENTS = 24;
  const MIN_AGE_MS = 1800;
  const SCAN_INTERVAL_MS = 900;

  const streamedCommentIds = new Set();
  const firstSeenAt = new WeakMap();
  const observedNodes = new WeakSet();
  let observedCount = 0;
  let prunedCount = 0;
  let sendMessageHooked = false;

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

  function isProfileHref(value) {
    const href = String(value || '');
    return /^\/[A-Za-z0-9._]+\/?(?:\?.*)?$/.test(href)
      && !href.startsWith('/explore/')
      && !href.startsWith('/accounts/')
      && !href.startsWith('/direct/');
  }

  function hasCommentShape(node) {
    if (!(node instanceof Element)) return false;
    if (node.getAttribute('aria-hidden') === 'true' && !node.childElementCount) return false;
    const text = String(node.innerText || '').replace(/\s+/g, ' ').trim();
    if (text.length > 3500) return false;

    const profiles = new Set([...node.querySelectorAll('a[href]')]
      .map((anchor) => anchor.getAttribute('href') || '')
      .filter(isProfileHref));
    if (!profiles.size || profiles.size > 4) return false;

    const hasTime = Boolean(node.querySelector('time'));
    const hasEngagement = /(?:^|\s)(?:Reply|Ответить)(?:\s|$)/i.test(text)
      || /\b\d[\d.,\s]*\s*(?:likes?|отмет(?:ка|ки|ок)\s+«?нравится»?)\b/i.test(text)
      || /(?:view|show|посмотреть|показать)\s+(?:all\s+)?\d+\s+(?:repl(?:y|ies)|ответ)/i.test(text);
    return hasTime || hasEngagement;
  }

  function hasPendingExpansion(node) {
    return [...node.querySelectorAll('button, [role="button"]')].some((button) => {
      const text = [
        button.innerText,
        button.getAttribute('aria-label'),
        button.querySelector('[aria-label]')?.getAttribute('aria-label'),
      ].filter(Boolean).join(' ').trim();
      return /view (?:all )?.*repl(?:y|ies)|show (?:all )?.*repl(?:y|ies)|посмотреть (?:все )?.*ответ|показать (?:все )?.*ответ/i.test(text);
    });
  }

  function nearestCommentContainer(seed, root) {
    let node = seed instanceof Element ? seed : seed?.parentElement;
    let best = null;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      if (root && !root.contains(node)) break;
      if (hasCommentShape(node)) best = node;
      if (node.matches?.('li') && best) break;
    }
    return best;
  }

  function commentNodes() {
    const root = commentsDialog();
    if (!root) return [];

    const seen = new Set();
    const nodes = [];
    const push = (node) => {
      if (!node || seen.has(node) || !hasCommentShape(node)) return;
      seen.add(node);
      nodes.push(node);
      if (!observedNodes.has(node)) {
        observedNodes.add(node);
        observedCount += 1;
      }
      if (!firstSeenAt.has(node)) firstSeenAt.set(node, Date.now());
    };

    root.querySelectorAll('ul li').forEach(push);
    root.querySelectorAll('time').forEach((time) => push(nearestCommentContainer(time, root)));
    root.querySelectorAll('a[href]').forEach((anchor) => {
      if (isProfileHref(anchor.getAttribute('href'))) push(nearestCommentContainer(anchor, root));
    });
    return nodes;
  }

  function outsideVisibleCommentArea(node, root) {
    const rect = node.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return rect.bottom < rootRect.top || rect.top > rootRect.bottom;
  }

  function clearHeavyCommentNode(node) {
    if (!(node instanceof HTMLElement) || !node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    const height = Math.max(1, Math.min(1400, Math.round(rect.height || node.offsetHeight || 1)));

    try {
      node.querySelectorAll('video, audio').forEach((media) => {
        try { media.pause?.(); } catch { /* no-op */ }
        media.removeAttribute('src');
        media.querySelectorAll('source').forEach((source) => source.removeAttribute('src'));
      });
      node.replaceChildren();
      node.setAttribute('aria-hidden', 'true');
      node.style.height = `${height}px`;
      node.style.minHeight = `${height}px`;
      node.style.maxHeight = `${height}px`;
      node.style.overflow = 'hidden';
      node.style.pointerEvents = 'none';
      node.style.contain = 'strict';
      prunedCount += 1;
      return true;
    } catch {
      return false;
    }
  }

  function prune() {
    const root = commentsDialog();
    if (!root) return;

    const nodes = commentNodes();
    const thresholdReached = streamedCommentIds.size > PRUNE_AFTER_COLLECTED
      || (!sendMessageHooked && observedCount > PRUNE_AFTER_COLLECTED + 20);
    if (!thresholdReached || nodes.length <= KEEP_LIVE_COMMENTS) return;

    const now = Date.now();
    const keep = new Set(nodes.slice(-KEEP_LIVE_COMMENTS));
    const candidates = nodes.filter((node) => !keep.has(node));

    // Prefer leaf comment containers so deleting one comment never wipes a
    // larger parent subtree that may still contain uncollected replies.
    for (const node of candidates) {
      if (!node.isConnected) continue;
      if (now - (firstSeenAt.get(node) || now) < MIN_AGE_MS) continue;
      if (!outsideVisibleCommentArea(node, root)) continue;
      if (hasPendingExpansion(node)) continue;
      if (candidates.some((other) => other !== node && node.contains(other))) continue;
      clearHeavyCommentNode(node);
    }
  }

  function inspectOutgoingMessage(message) {
    if (!message || typeof message !== 'object') return message;

    if (message.type === 'CC_INSTAGRAM_COMMENT_BATCH') {
      for (const comment of Array.isArray(message.comments) ? message.comments : []) {
        const id = String(comment?.id || comment?.platformCommentId || '');
        if (id) streamedCommentIds.add(id);
      }
      queueMicrotask(prune);
      return message;
    }

    if (message.type === 'CC_INSTAGRAM_PROGRESS') {
      return {
        ...message,
        progress: {
          ...(message.progress || {}),
          domPruned: prunedCount,
          domPruneThreshold: PRUNE_AFTER_COLLECTED,
        },
      };
    }

    return message;
  }

  function installSendMessageHook() {
    const runtime = chrome?.runtime;
    if (!runtime?.sendMessage) return false;
    const original = runtime.sendMessage.bind(runtime);

    const wrapped = (...args) => {
      const messageIndex = args.findIndex((arg) => arg && typeof arg === 'object' && typeof arg.type === 'string');
      if (messageIndex >= 0) args[messageIndex] = inspectOutgoingMessage(args[messageIndex]);
      return original(...args);
    };

    try {
      runtime.sendMessage = wrapped;
      if (runtime.sendMessage === wrapped) return true;
    } catch {
      // Some Chromium builds expose extension API functions as non-writable.
    }

    try {
      Object.defineProperty(runtime, 'sendMessage', {
        configurable: true,
        writable: true,
        value: wrapped,
      });
      return runtime.sendMessage === wrapped;
    } catch {
      return false;
    }
  }

  sendMessageHooked = installSendMessageHook();
  window.setInterval(prune, SCAN_INTERVAL_MS);

  console.info('[CC Instagram DOM pruner] ready', {
    threshold: PRUNE_AFTER_COLLECTED,
    keepLive: KEEP_LIVE_COMMENTS,
    sendMessageHooked,
  });
})();
