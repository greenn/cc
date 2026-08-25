import { store } from './store.js';

const passState = new Map();

function stateFor(passId) {
  let state = passState.get(passId);
  if (!state) {
    state = { ids: new Set(), received: 0, added: 0, cleanupTimer: null };
    state.cleanupTimer = window.setTimeout(() => passState.delete(passId), 10 * 60 * 1000);
    passState.set(passId, state);
  }
  return state;
}

function commentKey(comment) {
  return String(comment?.platformCommentId || comment?.id || '');
}

function handleBatch(message) {
  const sourceId = String(message.sourceId || '');
  const passId = String(message.passId || `${sourceId}:stream`);
  const incoming = Array.isArray(message.comments) ? message.comments.filter(Boolean) : [];
  if (!sourceId || !incoming.length || !store.getSource(sourceId)) return;

  const pass = stateFor(passId);
  const unique = [];
  for (const comment of incoming) {
    const key = commentKey(comment);
    if (!key || pass.ids.has(key)) continue;
    pass.ids.add(key);
    unique.push(comment);
  }
  if (!unique.length) return;

  const before = store.getComments(sourceId).length;
  store.upsertComments(sourceId, unique);
  const total = store.getComments(sourceId).length;
  const added = Math.max(0, total - before);
  pass.received += unique.length;
  pass.added += added;

  store.updateSource(sourceId, {
    loadedCount: total,
    commentCount: total,
    instagramLastStreamedAt: new Date().toISOString(),
  });

  window.dispatchEvent(new CustomEvent('cc:instagram-stream-saved', {
    detail: {
      sourceId,
      passId,
      received: pass.received,
      added: pass.added,
      storedTotal: total,
      batchSize: unique.length,
      batchAdded: added,
    },
  }));
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== 'cc-helper' || message.type !== 'CC_HELPER_COMMENT_BATCH') return;
  handleBatch(message);
});

console.info('[CC Instagram stream] live comment persistence ready');
