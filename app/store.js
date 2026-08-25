const STORAGE_KEY = 'cc-comment-collection-v0.1';

const defaults = () => ({
  version: 1,
  settings: { youtubeApiKey: '' },
  sources: [],
  comments: {},
});

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    return {
      ...defaults(),
      ...parsed,
      settings: { ...defaults().settings, ...(parsed.settings || {}) },
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      comments: parsed.comments && typeof parsed.comments === 'object' ? parsed.comments : {},
    };
  } catch (error) {
    console.warn('CC: could not read local state', error);
    return defaults();
  }
}

let state = readState();

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function attachmentKey(item) {
  if (!item || typeof item !== 'object') return '';
  return `${item.type || 'image'}:${item.url || item.previewUrl || item.poster || item.thumbnail || ''}`;
}

function mergeAttachments(previous, incoming) {
  const result = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = attachmentKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function instagramFallbackKey(comment) {
  if (!String(comment?.id || '').startsWith('instagram:')) return '';
  const username = String(comment.authorUsername || comment.authorName || '').trim().toLowerCase();
  const publishedAt = String(comment.publishedAt || '').trim();
  const text = String(comment.text || '').trim();
  if (!username || (!publishedAt && !text)) return '';
  return `${username}\n${publishedAt}\n${text}`;
}

export const store = {
  getState() {
    return state;
  },

  getSettings() {
    return state.settings;
  },

  setSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    persist();
    return state.settings;
  },

  getSources() {
    return state.sources;
  },

  getSource(id) {
    return state.sources.find((source) => source.id === id) || null;
  },

  upsertSource(source) {
    const index = state.sources.findIndex((item) => item.id === source.id);
    if (index === -1) state.sources.push(source);
    else state.sources[index] = { ...state.sources[index], ...source };
    persist();
    return this.getSource(source.id);
  },

  updateSource(id, patch) {
    const source = this.getSource(id);
    if (!source) return null;
    Object.assign(source, patch, { updatedAt: new Date().toISOString() });
    persist();
    return source;
  },

  removeSource(id) {
    state.sources = state.sources.filter((source) => source.id !== id);
    delete state.comments[id];
    persist();
  },

  getComments(sourceId) {
    if (sourceId) return state.comments[sourceId] || [];
    return Object.values(state.comments).flat();
  },

  getComment(sourceId, commentId) {
    return (state.comments[sourceId] || []).find((comment) => comment.id === commentId) || null;
  },

  findComment(commentId) {
    for (const [sourceId, comments] of Object.entries(state.comments)) {
      const comment = comments.find((item) => item.id === commentId);
      if (comment) return { sourceId, comment };
    }
    return null;
  },

  upsertComments(sourceId, incoming) {
    const existing = state.comments[sourceId] || [];
    const byPlatformId = new Map(existing.map((comment) => [comment.platformCommentId, comment]));
    const byInstagramFallback = new Map(existing
      .map((comment) => [instagramFallbackKey(comment), comment])
      .filter(([key]) => Boolean(key)));

    for (const next of incoming) {
      const fallbackKey = instagramFallbackKey(next);
      const old = byPlatformId.get(next.platformCommentId)
        || (fallbackKey ? byInstagramFallback.get(fallbackKey) : null);
      if (old) {
        const attachments = mergeAttachments(old.attachments, next.attachments);
        Object.assign(old, next, {
          attachments,
          read: old.read,
          readAt: old.readAt,
          saved: old.saved,
          savedAt: old.savedAt,
          highlighted: Boolean(old.highlighted),
          highlightedAt: old.highlightedAt || null,
          deleted: old.deleted,
          deletedAt: old.deletedAt,
          note: old.note,
          createdAt: old.createdAt,
          updatedAt: new Date().toISOString(),
        });
        byPlatformId.set(old.platformCommentId, old);
        const newFallbackKey = instagramFallbackKey(old);
        if (newFallbackKey) byInstagramFallback.set(newFallbackKey, old);
      } else {
        const created = {
          ...next,
          attachments: mergeAttachments([], next.attachments),
          read: false,
          readAt: null,
          saved: false,
          savedAt: null,
          highlighted: false,
          highlightedAt: null,
          deleted: false,
          deletedAt: null,
          note: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        existing.push(created);
        byPlatformId.set(created.platformCommentId, created);
        const newFallbackKey = instagramFallbackKey(created);
        if (newFallbackKey) byInstagramFallback.set(newFallbackKey, created);
      }
    }

    state.comments[sourceId] = existing;
    persist();
    return existing;
  },

  updateComment(sourceId, commentId, patch) {
    const comment = this.getComment(sourceId, commentId);
    if (!comment) return null;
    Object.assign(comment, patch, { updatedAt: new Date().toISOString() });
    persist();
    return comment;
  },

  markRead(sourceId, commentId) {
    const comment = this.getComment(sourceId, commentId);
    if (!comment || comment.read) return comment;
    const now = new Date().toISOString();
    this.updateComment(sourceId, commentId, { read: true, readAt: now });
    this.updateSource(sourceId, { lastVisibleCommentId: commentId, lastOpenedAt: now });
    return comment;
  },

  reset() {
    state = defaults();
    persist();
  },
};
