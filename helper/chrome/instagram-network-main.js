(() => {
  if (window.__CC_INSTAGRAM_NETWORK_MAIN__) return;
  window.__CC_INSTAGRAM_NETWORK_MAIN__ = true;

  const originalFetch = window.fetch.bind(window);
  let lastCapture = null;
  let activeJob = null;

  function post(type, detail = {}) {
    window.postMessage({ source: 'cc-instagram-network-main', type, ...detail }, '*');
  }

  function simpleHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function mediaKind(value) {
    try {
      const path = new URL(String(value || '')).pathname.toLowerCase();
      if (/\.(?:gif|gifv|webp|jpe?g|png|avif)$/.test(path)) return 'image';
      if (/\.(?:mp4|webm|mov|m4v)$/.test(path)) return 'video';
    } catch { /* no-op */ }
    return '';
  }

  function directMediaAttachments(value) {
    const output = [];
    const seen = new Set();

    function walk(node, depth = 0, branch = '') {
      if (depth > 7 || node == null) return;
      if (typeof node === 'string') {
        if (/profile|avatar/i.test(branch)) return;
        const kind = mediaKind(node);
        if (!kind || seen.has(node)) return;
        seen.add(node);
        output.push({ type: kind, url: node, previewUrl: '', alt: '' });
        return;
      }
      if (Array.isArray(node)) {
        node.slice(0, 30).forEach((item) => walk(item, depth + 1, branch));
        return;
      }
      if (typeof node !== 'object') return;
      for (const [key, child] of Object.entries(node)) {
        if (/profile_pic|profile_image|avatar/i.test(key)) continue;
        walk(child, depth + 1, `${branch}.${key}`);
      }
    }

    walk(value);
    return output.slice(0, 8);
  }

  function commentText(node) {
    const candidates = [node?.text, node?.comment_text, node?.content, node?.body, node?.message];
    return String(candidates.find((value) => typeof value === 'string' && value.trim()) || '').trim();
  }

  function authorObject(node) {
    return node?.user || node?.owner || node?.author || node?.commenter || node?.user_info || null;
  }

  function looksLikeComment(node) {
    if (!node || typeof node !== 'object') return false;
    const text = commentText(node);
    const author = authorObject(node);
    const hasIdentity = Boolean(node.id || node.pk || node.comment_id || node.commentId);
    return Boolean((text || hasIdentity) && (author || hasIdentity));
  }

  function connectionCandidate(value, path = '$', output = [], depth = 0) {
    if (depth > 12 || value == null || typeof value !== 'object') return output;

    if (Array.isArray(value.edges) && value.page_info && typeof value.page_info === 'object') {
      const nodes = value.edges.slice(0, 12).map((edge) => edge?.node || edge).filter(Boolean);
      const commentScore = nodes.filter(looksLikeComment).length;
      if (commentScore) {
        output.push({
          kind: 'edges',
          path,
          container: value,
          score: commentScore * 20 + Math.min(value.edges.length, 20),
        });
      }
    }

    if (Array.isArray(value.comments) && value.paging && typeof value.paging === 'object') {
      const commentScore = value.comments.slice(0, 12).filter(looksLikeComment).length;
      if (commentScore) {
        output.push({
          kind: 'comments',
          path,
          container: value,
          score: commentScore * 20 + Math.min(value.comments.length, 20),
        });
      }
    }

    if (Array.isArray(value)) {
      value.slice(0, 60).forEach((child, index) => connectionCandidate(child, `${path}[${index}]`, output, depth + 1));
      return output;
    }

    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') connectionCandidate(child, `${path}.${key}`, output, depth + 1);
    }
    return output;
  }

  function bestConnection(json) {
    const candidates = connectionCandidate(json).sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  function pageComments(candidate) {
    if (!candidate) return [];
    if (candidate.kind === 'comments') return candidate.container.comments || [];
    return (candidate.container.edges || []).map((edge) => edge?.node || edge).filter(Boolean);
  }

  function pageInfo(candidate) {
    if (!candidate) return { hasNext: false, cursor: '' };
    if (candidate.kind === 'comments') {
      const paging = candidate.container.paging || {};
      return {
        hasNext: Boolean(paging.has_next_page ?? paging.hasNextPage ?? paging.next),
        cursor: String(paging.end_cursor || paging.next_cursor || paging.cursor || paging.next || ''),
      };
    }
    const info = candidate.container.page_info || {};
    return {
      hasNext: Boolean(info.has_next_page ?? info.hasNextPage),
      cursor: String(info.end_cursor || info.endCursor || info.next_cursor || ''),
    };
  }

  function normalizeTime(value) {
    if (!value) return null;
    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
      const number = Number(value);
      const ms = number < 1e12 ? number * 1000 : number;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function normalizeComment(node, sourceId) {
    if (!node || typeof node !== 'object') return null;
    const author = authorObject(node) || {};
    const username = String(author.username || author.user_name || author.handle || node.username || '').replace(/^@/, '').trim();
    const authorName = String(author.full_name || author.name || username || 'Instagram').trim();
    const text = commentText(node);
    const rawId = String(node.id || node.pk || node.comment_id || node.commentId || '').trim();
    const attachments = directMediaAttachments(node);
    if (!text && !attachments.length && !rawId) return null;

    const platformCommentId = rawId || simpleHash(`${username}\n${text}\n${node.created_at || node.created_at_utc || ''}`);
    const publishedAt = normalizeTime(node.created_at_utc || node.created_at || node.timestamp || node.taken_at);
    const likeCount = Number(node.comment_like_count ?? node.like_count ?? node.likes ?? 0) || 0;
    const replyCount = Number(node.child_comment_count ?? node.reply_count ?? node.replies_count ?? 0) || 0;
    const avatar = String(author.profile_pic_url || author.profile_pic_url_hd || author.profile_image_url || '').trim();
    const permalink = String(node.permalink || node.comment_permalink || '').trim();

    return {
      id: `instagram:${platformCommentId}`,
      sourceId,
      platformCommentId,
      parentCommentId: node.parent_comment_id ? String(node.parent_comment_id) : null,
      authorName,
      authorUsername: username ? `@${username}` : '',
      authorAvatar: avatar,
      text,
      attachments,
      attachmentScope: 'comment',
      attachmentParserVersion: 4,
      publishedAt,
      likeCount,
      replyCount,
      originalUrl: /^https?:\/\//i.test(permalink) ? permalink : '',
    };
  }

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input?.url || '';
  }

  function serializeHeaders(headers) {
    try {
      const source = new Headers(headers || {});
      return [...source.entries()];
    } catch {
      return [];
    }
  }

  async function requestTemplate(input, init = {}) {
    const url = requestUrl(input);
    if (!/instagram\.com\/.*graphql|instagram\.com\/api\/graphql/i.test(url)) return null;

    let body = '';
    if (typeof init?.body === 'string') body = init.body;
    else if (init?.body instanceof URLSearchParams) body = init.body.toString();
    else if (input instanceof Request && !['GET', 'HEAD'].includes((init?.method || input.method || 'GET').toUpperCase())) {
      try { body = await input.clone().text(); } catch { body = ''; }
    }

    return {
      url,
      method: String(init?.method || input?.method || 'POST').toUpperCase(),
      headers: serializeHeaders(init?.headers || input?.headers),
      credentials: init?.credentials || input?.credentials || 'include',
      body,
    };
  }

  function updateCursorInObject(value, cursor) {
    let changed = 0;
    function walk(node, depth = 0) {
      if (!node || typeof node !== 'object' || depth > 8) return;
      for (const key of Object.keys(node)) {
        const child = node[key];
        if (/^(?:after|cursor|after_cursor|end_cursor)$/i.test(key) || /(?:^|_)cursor$/i.test(key)) {
          if (typeof child === 'string' || child == null) {
            node[key] = cursor;
            changed += 1;
            continue;
          }
        }
        if (child && typeof child === 'object') walk(child, depth + 1);
      }
    }
    walk(value);
    return changed;
  }

  function bodyWithCursor(body, cursor) {
    const raw = String(body || '');
    if (!raw) return null;

    try {
      const params = new URLSearchParams(raw);
      const variablesRaw = params.get('variables');
      if (variablesRaw) {
        const variables = JSON.parse(variablesRaw);
        const changed = updateCursorInObject(variables, cursor);
        if (!changed) variables.after = cursor;
        params.set('variables', JSON.stringify(variables));
        return params.toString();
      }
    } catch { /* try JSON below */ }

    try {
      const json = JSON.parse(raw);
      const variables = json.variables && typeof json.variables === 'object' ? json.variables : json;
      const changed = updateCursorInObject(variables, cursor);
      if (!changed) variables.after = cursor;
      return JSON.stringify(json);
    } catch {
      return null;
    }
  }

  async function fetchPage(template, cursor) {
    const body = bodyWithCursor(template.body, cursor);
    if (!body) throw new Error('Captured Instagram GraphQL request did not expose editable cursor variables.');
    const response = await originalFetch(template.url, {
      method: template.method || 'POST',
      headers: template.headers,
      credentials: template.credentials || 'include',
      body,
    });
    if (!response.ok) throw new Error(`Instagram GraphQL returned HTTP ${response.status}.`);
    const json = await response.json();
    const candidate = bestConnection(json);
    if (!candidate) throw new Error('Instagram GraphQL response no longer contains a recognizable comment connection.');
    return candidate;
  }

  function emitCandidate(job, candidate, pageNumber) {
    const comments = pageComments(candidate)
      .map((node) => normalizeComment(node, job.sourceId))
      .filter(Boolean);
    const unique = [];
    for (const comment of comments) {
      if (job.ids.has(comment.platformCommentId)) continue;
      job.ids.add(comment.platformCommentId);
      unique.push(comment);
    }
    if (unique.length) {
      post('CC_INSTAGRAM_NETWORK_BATCH', {
        jobId: job.jobId,
        sourceId: job.sourceId,
        passId: job.passId,
        page: pageNumber,
        comments: unique,
      });
    }
    return unique.length;
  }

  async function runJob(job, capture) {
    if (job.running) return;
    job.running = true;
    try {
      let candidate = capture.candidate;
      let template = capture.template;
      let page = 1;
      let total = 0;
      let repeatedEmptyPages = 0;
      const seenCursors = new Set();

      while (candidate && page <= job.maxPages) {
        const added = emitCandidate(job, candidate, page);
        total += added;
        repeatedEmptyPages = added ? 0 : repeatedEmptyPages + 1;
        const info = pageInfo(candidate);
        post('CC_INSTAGRAM_NETWORK_PROGRESS', {
          jobId: job.jobId,
          sourceId: job.sourceId,
          passId: job.passId,
          page,
          maxPages: job.maxPages,
          collected: job.ids.size,
          cursor: info.cursor,
          hasNext: info.hasNext,
        });

        if (!info.hasNext || !info.cursor) {
          post('CC_INSTAGRAM_NETWORK_COMPLETE', {
            jobId: job.jobId,
            sourceId: job.sourceId,
            passId: job.passId,
            pages: page,
            collected: job.ids.size,
            stoppedBy: 'end-cursor',
          });
          activeJob = null;
          return;
        }
        if (seenCursors.has(info.cursor)) {
          post('CC_INSTAGRAM_NETWORK_COMPLETE', {
            jobId: job.jobId,
            sourceId: job.sourceId,
            passId: job.passId,
            pages: page,
            collected: job.ids.size,
            stoppedBy: 'repeated-cursor',
          });
          activeJob = null;
          return;
        }
        if (repeatedEmptyPages >= 4) {
          post('CC_INSTAGRAM_NETWORK_COMPLETE', {
            jobId: job.jobId,
            sourceId: job.sourceId,
            passId: job.passId,
            pages: page,
            collected: job.ids.size,
            stoppedBy: 'no-new-comments',
          });
          activeJob = null;
          return;
        }

        seenCursors.add(info.cursor);
        candidate = await fetchPage(template, info.cursor);
        page += 1;
        await new Promise((resolve) => setTimeout(resolve, job.delayMs));
      }

      post('CC_INSTAGRAM_NETWORK_COMPLETE', {
        jobId: job.jobId,
        sourceId: job.sourceId,
        passId: job.passId,
        pages: Math.min(page, job.maxPages),
        collected: job.ids.size,
        stoppedBy: 'page-limit',
      });
      activeJob = null;
    } catch (error) {
      post('CC_INSTAGRAM_NETWORK_ERROR', {
        jobId: job.jobId,
        sourceId: job.sourceId,
        passId: job.passId,
        error: error?.message || String(error),
      });
      activeJob = null;
    }
  }

  async function inspectGraphqlResponse(input, init, response) {
    try {
      if (!response?.ok) return;
      const template = await requestTemplate(input, init);
      if (!template) return;
      const json = await response.clone().json();
      const candidate = bestConnection(json);
      if (!candidate) return;
      lastCapture = { template, candidate, capturedAt: Date.now() };
      post('CC_INSTAGRAM_NETWORK_CAPTURED', {
        path: candidate.path,
        items: pageComments(candidate).length,
        hasNext: pageInfo(candidate).hasNext,
      });
      if (activeJob && !activeJob.running) void runJob(activeJob, lastCapture);
    } catch {
      // Non-JSON GraphQL responses and unrelated requests are ignored.
    }
  }

  window.fetch = async function ccInstagramNetworkFetch(input, init) {
    const response = await originalFetch(input, init);
    void inspectGraphqlResponse(input, init || {}, response);
    return response;
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== 'cc-instagram-network-isolated') return;

    if (message.type === 'CC_INSTAGRAM_NETWORK_START') {
      activeJob = {
        jobId: String(message.jobId || `${Date.now()}`),
        sourceId: String(message.sourceId || ''),
        passId: String(message.passId || ''),
        maxPages: Math.max(1, Math.min(600, Number(message.maxPages || 180))),
        delayMs: Math.max(120, Math.min(2000, Number(message.delayMs || 350))),
        ids: new Set(),
        running: false,
      };
      post('CC_INSTAGRAM_NETWORK_WAITING', {
        jobId: activeJob.jobId,
        sourceId: activeJob.sourceId,
        passId: activeJob.passId,
      });
      if (lastCapture && Date.now() - lastCapture.capturedAt < 60000) void runJob(activeJob, lastCapture);
      return;
    }

    if (message.type === 'CC_INSTAGRAM_NETWORK_CANCEL' && activeJob?.jobId === message.jobId) {
      activeJob = null;
    }
  });

  console.info('[CC Instagram network main] GraphQL comment request capture ready');
})();
