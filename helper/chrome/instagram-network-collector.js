(() => {
  if (window.__CC_INSTAGRAM_NETWORK_COLLECTOR__) return;
  window.__CC_INSTAGRAM_NETWORK_COLLECTOR__ = true;

  const jobs = new Map();

  function sendRuntime(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        void chrome.runtime.lastError;
        resolve(response || null);
      });
    });
  }

  function reportProgress(job, phase, detail = {}, force = false) {
    const now = Date.now();
    if (!force && now - job.lastProgressAt < 160) return;
    job.lastProgressAt = now;
    void sendRuntime({
      type: 'CC_INSTAGRAM_PROGRESS',
      sourceId: job.sourceId,
      progress: {
        passId: job.passId,
        phase,
        collected: job.comments.size,
        streamed: job.streamed.size,
        clicks: 0,
        scrollMoves: 0,
        pageDowns: 0,
        manualScrollMoves: 0,
        step: Math.max(0, Number(detail.page || 0)),
        maxSteps: Math.max(0, Number(detail.maxPages || job.maxPages || 0)),
        stableRounds: 0,
        stableLimit: 0,
        networkCursor: String(detail.cursor || ''),
        networkHasNext: Boolean(detail.hasNext),
        timestamp: now,
      },
    });
  }

  function streamBatch(job, comments, page) {
    const fresh = [];
    for (const comment of Array.isArray(comments) ? comments : []) {
      const id = String(comment?.id || comment?.platformCommentId || '');
      if (!id) continue;
      job.comments.set(id, comment);
      if (job.streamed.has(id)) continue;
      job.streamed.add(id);
      fresh.push(comment);
    }

    for (let start = 0; start < fresh.length; start += 25) {
      const chunk = fresh.slice(start, start + 25);
      void sendRuntime({
        type: 'CC_INSTAGRAM_COMMENT_BATCH',
        sourceId: job.sourceId,
        passId: job.passId,
        batchId: `${job.passId}:network:${page}:${start}`,
        comments: chunk,
        meta: {
          phase: 'network-page',
          method: 'network',
          page,
          batchSize: chunk.length,
          timestamp: Date.now(),
        },
      });
    }
  }

  function finish(job, message) {
    if (!job || job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    jobs.delete(job.jobId);
    reportProgress(job, 'network-complete', {
      page: message.pages || 0,
      maxPages: job.maxPages,
    }, true);
    job.resolve({
      comments: [...job.comments.values()],
      clicks: 0,
      passId: job.passId,
      pageUrl: location.href,
      diagnostics: {
        method: 'network',
        pages: Number(message.pages || 0),
        parsedComments: job.comments.size,
        streamedComments: job.streamed.size,
        stoppedBy: message.stoppedBy || 'complete',
        graphQlCaptured: job.captured,
      },
      note: 'Comments were collected from Instagram web GraphQL pagination captured from the signed-in page. This is an experimental private-web format and can change without notice.',
    });
  }

  function fail(job, error) {
    if (!job || job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    jobs.delete(job.jobId);
    window.postMessage({
      source: 'cc-instagram-network-isolated',
      type: 'CC_INSTAGRAM_NETWORK_CANCEL',
      jobId: job.jobId,
    }, '*');
    job.reject(new Error(error || 'Instagram network comment collection failed.'));
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== 'cc-instagram-network-main') return;

    if (message.type === 'CC_INSTAGRAM_NETWORK_CAPTURED') {
      for (const job of jobs.values()) {
        job.captured = true;
        reportProgress(job, 'network-captured', { page: 0, maxPages: job.maxPages }, true);
      }
      return;
    }

    const job = jobs.get(String(message.jobId || ''));
    if (!job) return;

    if (message.type === 'CC_INSTAGRAM_NETWORK_WAITING') {
      reportProgress(job, 'network-wait', { page: 0, maxPages: job.maxPages }, true);
      return;
    }

    if (message.type === 'CC_INSTAGRAM_NETWORK_BATCH') {
      streamBatch(job, message.comments, Number(message.page || 0));
      reportProgress(job, 'network-page', {
        page: Number(message.page || 0),
        maxPages: job.maxPages,
      }, true);
      return;
    }

    if (message.type === 'CC_INSTAGRAM_NETWORK_PROGRESS') {
      reportProgress(job, 'network-page', {
        page: Number(message.page || 0),
        maxPages: Number(message.maxPages || job.maxPages),
        cursor: message.cursor || '',
        hasNext: message.hasNext,
      });
      return;
    }

    if (message.type === 'CC_INSTAGRAM_NETWORK_COMPLETE') {
      finish(job, message);
      return;
    }

    if (message.type === 'CC_INSTAGRAM_NETWORK_ERROR') {
      fail(job, message.error || 'Instagram GraphQL cursor collection failed.');
    }
  });

  window.__CC_INSTAGRAM_NETWORK_COLLECT__ = ({ sourceId, passId, maxPages = 180, timeoutMs = 360000 } = {}) => {
    const jobId = `${passId || sourceId || 'instagram'}:network:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    return new Promise((resolve, reject) => {
      const job = {
        jobId,
        sourceId: String(sourceId || ''),
        passId: String(passId || ''),
        maxPages: Math.max(1, Math.min(600, Number(maxPages || 180))),
        comments: new Map(),
        streamed: new Set(),
        captured: false,
        lastProgressAt: 0,
        done: false,
        resolve,
        reject,
        timer: null,
      };
      job.timer = setTimeout(() => {
        fail(job, 'No usable Instagram GraphQL comment pagination request was captured in time. Switch Instagram comment method back to DOM, or retry Network while the Comments panel is actively loading.');
      }, Math.max(20000, Number(timeoutMs || 360000)));
      jobs.set(jobId, job);
      reportProgress(job, 'network-wait', { page: 0, maxPages: job.maxPages }, true);
      window.postMessage({
        source: 'cc-instagram-network-isolated',
        type: 'CC_INSTAGRAM_NETWORK_START',
        jobId,
        sourceId: job.sourceId,
        passId: job.passId,
        maxPages: job.maxPages,
        delayMs: 350,
      }, '*');
    });
  };

  console.info('[CC Instagram network collector] isolated GraphQL bridge ready');
})();
