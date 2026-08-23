(() => {
  const VERSION = '0.4.6';
  const startedAt = performance.now();
  const prefix = `[CC ${VERSION}]`;

  window.__CC_DEBUG__ = {
    version: VERSION,
    startedAt,
    route: location.href,
  };

  console.info(`${prefix} boot`, {
    href: location.href,
    readyState: document.readyState,
    visibility: document.visibilityState,
  });

  window.addEventListener('error', (event) => {
    console.error(`${prefix} window error`, event.error || event.message, {
      file: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error(`${prefix} unhandled promise rejection`, event.reason);
  });

  if ('PerformanceObserver' in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 100) {
            console.warn(`${prefix} long task`, {
              durationMs: Math.round(entry.duration),
              startMs: Math.round(entry.startTime),
            });
          }
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // Long Task API is optional.
    }
  }

  window.addEventListener('load', () => {
    console.info(`${prefix} window load`, {
      elapsedMs: Math.round(performance.now() - startedAt),
      resources: performance.getEntriesByType('resource').length,
      commentCards: document.querySelectorAll('.comment-card').length,
      sourceCards: document.querySelectorAll('.source-overview-card').length,
    });
  }, { once: true });

  setTimeout(() => {
    const resources = performance.getEntriesByType('resource');
    const images = resources.filter((entry) => entry.initiatorType === 'img');
    console.info(`${prefix} 5s snapshot`, {
      readyState: document.readyState,
      elapsedMs: Math.round(performance.now() - startedAt),
      resources: resources.length,
      images: images.length,
      commentCards: document.querySelectorAll('.comment-card').length,
      sourceCards: document.querySelectorAll('.source-overview-card').length,
      activeSource: document.querySelector('.source-item.is-active')?.dataset.sourceId || null,
      url: location.href,
    });
  }, 5000);
})();
