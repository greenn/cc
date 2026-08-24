(() => {
  if (window.__CC_INSTAGRAM_MEDIA_INSTALLED__) return;
  window.__CC_INSTAGRAM_MEDIA_INSTALLED__ = true;

  function roots() {
    return [
      document.querySelector('[role="dialog"]'),
      document.querySelector('main article'),
      document.querySelector('article'),
      document.querySelector('main'),
    ].filter(Boolean);
  }

  function absoluteUrl(value) {
    if (!value || String(value).startsWith('blob:')) return '';
    try {
      return new URL(value, location.href).toString();
    } catch {
      return '';
    }
  }

  function imageUrl(img) {
    return absoluteUrl(img.currentSrc || img.src || img.getAttribute('src'));
  }

  function collectPhotos() {
    const found = new Set();
    for (const root of roots()) {
      root.querySelectorAll('img').forEach((img) => {
        const width = Number(img.naturalWidth || img.width || img.getAttribute('width') || 0);
        const height = Number(img.naturalHeight || img.height || img.getAttribute('height') || 0);
        if (width < 280 || height < 280) return; // skip avatars/icons
        const url = imageUrl(img);
        if (url) found.add(url);
      });
    }
    return [...found];
  }

  function collectVideos() {
    const found = new Set();
    for (const root of roots()) {
      root.querySelectorAll('video').forEach((video) => {
        const direct = absoluteUrl(video.currentSrc || video.src || video.getAttribute('src'));
        if (direct) found.add(direct);
        video.querySelectorAll('source[src]').forEach((source) => {
          const url = absoluteUrl(source.src || source.getAttribute('src'));
          if (url) found.add(url);
        });
      });
    }

    // Instagram can feed <video> through a blob URL. In that case the real
    // signed CDN request is still visible in the page's resource timings.
    performance.getEntriesByType('resource').forEach((entry) => {
      const url = absoluteUrl(entry.name);
      if (!url) return;
      if (/\.(mp4|webm|mov)(?:$|[?#])/i.test(url) || /video/i.test(entry.initiatorType || '')) found.add(url);
    });

    return [...found];
  }

  async function collectMedia(kind) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const urls = kind === 'video' ? collectVideos() : collectPhotos();
    return {
      kind,
      urls,
      pageUrl: location.href,
      counts: {
        video: collectVideos().length,
        photos: collectPhotos().length,
      },
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CC_INSTAGRAM_MEDIA') return false;
    collectMedia(message.kind === 'video' ? 'video' : 'photos')
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
