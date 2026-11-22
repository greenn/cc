import { helperRequest } from '../helper-client.js';

function parsePikabuStory(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^(?:www|m)\./i, '').toLowerCase();
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (host !== 'pikabu.ru') return null;
  const match = url.pathname.match(/^\/story\/(?:[^/]*?_)?(\d+)(?:\/)?$/i);
  if (!match) return null;
  const storyId = match[1];
  return {
    storyId,
    url: 'https://pikabu.ru' + url.pathname.replace(/\/$/, '') + '#comments',
  };
}

export const pikabuAdapter = {
  id: 'pikabu',
  label: 'Pikabu',

  canHandle(value) {
    try { return Boolean(parsePikabuStory(value)); } catch { return false; }
  },

  async getPost(value) {
    const target = parsePikabuStory(value);
    if (!target) throw new Error('Unsupported Pikabu story URL.');
    const now = new Date().toISOString();
    return {
      id: 'pikabu:' + target.storyId,
      platform: 'pikabu',
      externalId: target.storyId,
      url: target.url,
      title: 'Pikabu story ' + target.storyId,
      author: 'Pikabu',
      thumbnail: '',
      publishedAt: null,
      commentCount: null,
      loadedCount: 0,
      nextCursor: 'helper',
      hasMore: true,
      integrationStatus: 'helper-pending',
      lastVisibleCommentId: null,
      lastOpenedAt: null,
      addedAt: now,
      updatedAt: now,
    };
  },

  async getComments(source) {
    const result = await helperRequest('pikabu.collect', {
      url: source.url,
      sourceId: source.id,
      storyId: source.externalId,
      maxSteps: 800,
    }, 360000);

    const found = Math.max(0, Number(result?.foundCount || 0));
    const expected = Number.isFinite(Number(result?.expectedCount))
      && result?.expectedCount != null ? Math.max(0, Number(result.expectedCount)) : null;
    if (result?.error) throw new Error(result.error);
    if (!found && expected !== 0) {
      throw new Error('Pikabu returned no recognized comments. The post may be unavailable, or the layout may have changed.');
    }

    return {
      // Comments are streamed by the helper and persisted as soon as each batch arrives.
      comments: [],
      nextCursor: null,
      hasMore: false,
      totalResults: expected,
      title: result?.title || '',
      author: result?.author || '',
      incomplete: result?.complete === false,
      diagnostics: result?.diagnostics || null,
    };
  },
};
