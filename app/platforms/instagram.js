import { helperRequest } from '../helper-client.js';

function parseInstagramTarget(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'instagram.com') return null;

  const parts = url.pathname.split('/').filter(Boolean);
  const markerIndex = parts.findIndex((part) => ['p', 'reel', 'reels'].includes(part.toLowerCase()));
  if (markerIndex === -1 || !parts[markerIndex + 1]) return null;

  const kind = parts[markerIndex].toLowerCase() === 'p' ? 'post' : 'reel';
  const externalId = parts[markerIndex + 1];
  const username = markerIndex > 0 ? parts[markerIndex - 1] : null;

  return { externalId, kind, username };
}

export const instagramAdapter = {
  id: 'instagram',
  label: 'Instagram',

  canHandle(url) {
    try {
      return Boolean(parseInstagramTarget(url));
    } catch {
      return false;
    }
  },

  async getPost(url) {
    const target = parseInstagramTarget(url);
    if (!target) throw new Error('Unsupported Instagram URL.');

    const normalized = new URL(url);
    normalized.search = '';
    normalized.hash = '';

    return {
      id: `instagram:${target.externalId}`,
      platform: 'instagram',
      externalId: target.externalId,
      url: normalized.toString(),
      title: `Instagram ${target.kind}`,
      author: target.username ? `@${target.username}` : 'Instagram',
      thumbnail: '',
      publishedAt: null,
      commentCount: null,
      loadedCount: 0,
      nextCursor: 'helper',
      hasMore: true,
      // Add link must never switch the user away from CC. The app performs an
      // initial getComments call after adding every source, so the first helper
      // call is intentionally a no-op. An explicit Refresh then starts the
      // browser helper and opens/focuses Instagram only when the user asks for it.
      integrationStatus: 'helper-pending',
      lastVisibleCommentId: null,
      lastOpenedAt: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  async getComments(source) {
    if (source.integrationStatus === 'helper-pending') {
      return {
        comments: [],
        nextCursor: null,
        hasMore: false,
        totalResults: null,
      };
    }

    const result = await helperRequest('instagram.collect', {
      url: source.url,
      sourceId: source.id,
      maxClicks: 40,
    }, 120000);

    const comments = Array.isArray(result?.comments) ? result.comments : [];
    if (!comments.length) {
      throw new Error('Instagram helper connected, but no comments were recognized. Open the post while logged in and try Refresh; Instagram markup may also have changed.');
    }

    return {
      comments,
      nextCursor: null,
      hasMore: false,
      totalResults: comments.length,
    };
  },
};
