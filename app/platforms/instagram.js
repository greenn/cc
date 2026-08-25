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
      // Adding/opening an Instagram source must stay inside CC. Automatic loads
      // are intentionally deferred; only an explicit Refresh asks the helper
      // to visit Instagram and collect rendered comments.
      integrationStatus: 'helper-pending',
      lastVisibleCommentId: null,
      lastOpenedAt: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  async getComments(source, cursor = source?.nextCursor) {
    // app.js passes the stored cursor for automatic/add/open loads and null for
    // an explicit Refresh. Keep the automatic path a true no-op while leaving
    // hasMore=true, so clicking a source never launches Instagram and does not
    // permanently turn a newly-added 0/0 source into a finished source.
    if (cursor !== null) {
      return {
        comments: [],
        nextCursor: 'helper',
        hasMore: true,
        totalResults: null,
      };
    }

    const result = await helperRequest('instagram.collect', {
      url: source.url,
      sourceId: source.id,
      maxClicks: 40,
    }, 120000);

    if (result?.mediaAvailability) {
      window.dispatchEvent(new CustomEvent('cc:instagram-media-availability', {
        detail: {
          sourceId: source.id,
          availability: result.mediaAvailability,
        },
      }));
    }

    const comments = Array.isArray(result?.comments) ? result.comments : [];
    if (!comments.length) {
      const diagnostic = result?.diagnostics || {};
      const details = [
        Number.isFinite(Number(diagnostic.commentCandidates)) ? `candidates ${diagnostic.commentCandidates}` : '',
        Number.isFinite(Number(diagnostic.permalinkAnchors)) ? `permalinks ${diagnostic.permalinkAnchors}` : '',
        Number.isFinite(Number(diagnostic.timestamps)) ? `timestamps ${diagnostic.timestamps}` : '',
        diagnostic.reelPage
          ? `reel comments ${diagnostic.commentsPanelOpen ? 'open' : diagnostic.commentsPanelClickAttempted ? 'click attempted' : 'button not found'}`
          : '',
      ].filter(Boolean).join(' · ');
      throw new Error(`Instagram helper found no comments${details ? ` (${details})` : ''}. Make sure comments are visible on the post/reel and that CC Browser Helper is reloaded to the latest version.`);
    }

    return {
      comments,
      nextCursor: null,
      hasMore: false,
      totalResults: comments.length,
    };
  },
};
