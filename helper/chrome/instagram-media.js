(() => {
  if (window.__CC_INSTAGRAM_MEDIA_INSTALLED__) return;
  window.__CC_INSTAGRAM_MEDIA_INSTALLED__ = true;

  function isReelPage() {
    return /^\/reels?\//i.test(location.pathname);
  }

  function primaryRoot() {
    return document.querySelector('main article')
      || document.querySelector('article')
      || document.querySelector('main')
      || document.body;
  }

  function absoluteUrl(value) {
    if (!value || String(value).startsWith('blob:')) return '';
    try {
      return new URL(value, location.href).toString();
    } catch {
      return '';
    }
  }

  function visibleArea(node) {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 0;
    return rect.width * rect.height;
  }

  function directVideoUrl(video) {
    const direct = absoluteUrl(video.currentSrc || video.src || video.getAttribute('src'));
    if (direct) return direct;
    for (const source of video.querySelectorAll('source[src]')) {
      const url = absoluteUrl(source.currentSrc || source.src || source.getAttribute('src'));
      if (url) return url;
    }
    return '';
  }

  function bestPerformanceVideoUrl() {
    const candidates = performance.getEntriesByType('resource')
      .map((entry, index) => ({
        url: absoluteUrl(entry.name),
        transferSize: Number(entry.transferSize || entry.encodedBodySize || 0),
        index,
      }))
      .filter((entry) => entry.url && /\.(mp4|webm|mov)(?:$|[?#])/i.test(entry.url))
      .sort((a, b) => b.transferSize - a.transferSize || b.index - a.index);
    return candidates[0]?.url || '';
  }

  function collectVideos() {
    const root = primaryRoot();
    const videos = [...root.querySelectorAll('video')]
      .map((video) => ({ video, area: visibleArea(video) }))
      .sort((a, b) => b.area - a.area);

    if (isReelPage()) {
      const main = videos[0]?.video || null;
      if (!main) return { urls: [], count: 0 };
      const url = directVideoUrl(main) || bestPerformanceVideoUrl();
      return { urls: url ? [url] : [], count: 1 };
    }

    const found = new Set();
    for (const { video } of videos) {
      const url = directVideoUrl(video);
      if (url) found.add(url);
    }
    if (!found.size && videos.length) {
      const fallback = bestPerformanceVideoUrl();
      if (fallback) found.add(fallback);
    }
    return { urls: [...found], count: found.size || (videos.length ? 1 : 0) };
  }

  function imageUrl(img) {
    return absoluteUrl(img.currentSrc || img.src || img.getAttribute('src'));
  }

  function isProfileImage(img) {
    const anchor = img.closest('a[href]');
    const href = anchor?.getAttribute('href') || '';
    return /^\/[A-Za-z0-9._]+\/?(?:\?.*)?$/.test(href);
  }

  function collectPhotos() {
    if (isReelPage()) return { urls: [], count: 0 };

    const root = primaryRoot();
    const found = new Set();
    root.querySelectorAll('img').forEach((img) => {
      const width = Number(img.naturalWidth || img.width || img.getAttribute('width') || 0);
      const height = Number(img.naturalHeight || img.height || img.getAttribute('height') || 0);
      if (width < 320 || height < 320) return;
      if (isProfileImage(img) || img.closest('header')) return;
      const url = imageUrl(img);
      if (url) found.add(url);
    });
    return { urls: [...found], count: found.size };
  }

  async function collectMedia(kind) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const videos = collectVideos();
    const photos = collectPhotos();
    return {
      kind,
      urls: kind === 'video' ? videos.urls : photos.urls,
      pageUrl: location.href,
      counts: {
        video: videos.count,
        photos: photos.count,
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