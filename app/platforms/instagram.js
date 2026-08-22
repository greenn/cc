function parseInstagramId(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, '');
  if (!host.endsWith('instagram.com')) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (!['p', 'reel', 'reels'].includes(parts[0])) return null;
  return parts[1] || null;
}

export const instagramAdapter = {
  id: 'instagram',
  label: 'Instagram',

  canHandle(url) {
    try {
      return Boolean(parseInstagramId(url));
    } catch {
      return false;
    }
  },

  async getPost(url) {
    const externalId = parseInstagramId(url);
    if (!externalId) throw new Error('Unsupported Instagram URL.');
    const normalized = new URL(url);
    normalized.search = '';
    normalized.hash = '';

    return {
      id: `instagram:${externalId}`,
      platform: 'instagram',
      externalId,
      url: normalized.toString(),
      title: `Instagram ${normalized.pathname.includes('/reel') ? 'reel' : 'post'}`,
      author: 'Instagram',
      thumbnail: '',
      publishedAt: null,
      commentCount: null,
      loadedCount: 0,
      nextCursor: null,
      hasMore: false,
      integrationStatus: 'helper-required',
      lastVisibleCommentId: null,
      lastOpenedAt: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  async getComments() {
    throw new Error('Instagram comments need an authenticated API or browser helper. The adapter boundary is ready, but direct browser scraping is intentionally not used.');
  },
};
