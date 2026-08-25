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

function helperTargetUrl(value) {
  const url = new URL(value);
  // Instagram's plural /reels/<id>/ route behaves like a feed and is much
  // less stable for background comment loading. The same item has a canonical
  // single-Reel route, which is better suited for the temporary worker tab.
  url.pathname = url.pathname.replace(/^\/reels\//i, '/reel/');
  url.search = '';
  url.hash = '';
  return url.toString();
}

function showCollectWarning(message) {
  const banner = document.querySelector('#status-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.dataset.kind = 'error';
  banner.hidden = false;
  clearTimeout(showCollectWarning.timer);
  showCollectWarning.timer = setTimeout(() => { banner.hidden = true; }, 12000);
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
      integrationStatus: 'helper-pending',
      lastVisibleCommentId: null,
      lastOpenedAt: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  async getComments(source, cursor = source?.nextCursor, options = {}) {
    if (cursor !== null) {
      return {
        comments: [],
        nextCursor: 'helper',
        hasMore: true,
        totalResults: null,
      };
    }

    const maxClicks = Math.max(1, Number(options.maxClicks || 40));
    const timeoutMs = Math.max(120000, Number(options.timeoutMs || 180000));
    const result = await helperRequest('instagram.collect', {
      url: helperTargetUrl(source.url),
      sourceId: source.id,
      maxClicks,
    }, timeoutMs);

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
        Number.isFinite(Number(diagnostic.timestamps)) ? `timestamps ${diagnostic.timestamps}` : '',
        diagnostic.reelPage
          ? `reel panel ${diagnostic.commentsPanelOpen ? 'open' : diagnostic.commentsPanelClickAttempted ? 'click attempted' : 'button not found'}`
          : '',
      ].filter(Boolean).join(' · ');

      // Zero parsed comments is not evidence that the post was deleted. Keep
      // the source refreshable and never offer destructive deletion here.
      showCollectWarning(`Instagram returned no parsed comments${details ? ` (${details})` : ''}. The source was kept; try Refresh again if Instagram was still loading.`);
      return {
        comments: [],
        nextCursor: 'helper',
        hasMore: true,
        totalResults: null,
        diagnostics: result?.diagnostics || null,
      };
    }

    return {
      comments,
      nextCursor: null,
      hasMore: false,
      totalResults: comments.length,
      diagnostics: result?.diagnostics || null,
    };
  },
};
