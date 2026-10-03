import { store } from './store.js';
import { detectTextLanguage, languageBadge, recordDetectedLanguage } from './comment-language.js';

const commentsList = document.querySelector('#comments-list');
const statusBanner = document.querySelector('#status-banner');
const translatorCache = new Map();

function targetLanguage() {
  return String(store.getSettings().translationTargetLanguage || 'ru').toLowerCase();
}

function targetLabel() {
  return targetLanguage() === 'ru' ? 'Russian' : targetLanguage().toUpperCase();
}

function showStatus(message, kind = 'info') {
  if (!statusBanner) return;
  statusBanner.textContent = message;
  statusBanner.dataset.kind = kind;
  statusBanner.hidden = false;
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => {
    statusBanner.hidden = true;
  }, kind === 'error' ? 12000 : 5000);
}

function ensureStyles() {
  if (document.querySelector('#cc-translate-styles')) return;
  const style = document.createElement('style');
  style.id = 'cc-translate-styles';
  style.textContent = `
    .comment-translate-action.is-active {
      text-decoration: underline;
      text-decoration-thickness: 1.5px;
      text-underline-offset: 3px;
      font-weight: 650;
    }
    .comment-translate-action[disabled] {
      opacity: .58;
      cursor: wait;
    }
  `;
  document.head.appendChild(style);
}

function commentForCard(card) {
  const sourceId = card?.dataset.sourceId;
  const commentId = card?.dataset.commentId;
  if (!sourceId || !commentId) return null;
  const comment = store.getComment(sourceId, commentId);
  return comment ? { sourceId, commentId, comment } : null;
}

function renderCardTranslation(card) {
  const found = commentForCard(card);
  const textNode = card?.querySelector('.comment-text');
  const button = card?.querySelector('.comment-translate-action');
  if (!found || !textNode || !button) return;

  const shown = Boolean(found.comment.translationRu && found.comment.translationShown);
  const sourceLanguage = String(found.comment.detectedLanguage || found.comment.translationSourceLanguage || '').toLowerCase();
  const sourceBadge = languageBadge(sourceLanguage);
  const targetBadge = languageBadge(targetLanguage());

  textNode.textContent = shown ? found.comment.translationRu : found.comment.text;
  textNode.style.whiteSpace = 'pre-line';
  button.classList.toggle('is-active', shown);
  button.setAttribute('aria-pressed', shown ? 'true' : 'false');

  if (sourceLanguage === 'emoji') {
    button.textContent = 'Emoji';
    button.disabled = true;
    button.title = 'Emoji-only comment; translation is not needed.';
    return;
  }

  button.disabled = false;
  if (shown) {
    button.textContent = sourceBadge ? `${sourceBadge} → ${targetBadge}` : 'Translated';
    button.title = sourceBadge
      ? `Translated from ${sourceBadge} to ${targetBadge}. Show original text.`
      : 'Show original text';
    return;
  }

  button.textContent = sourceBadge && sourceLanguage !== 'general'
    ? `Translate · ${sourceBadge}`
    : 'Translate';
  button.title = sourceBadge && sourceLanguage !== 'general'
    ? `Translate from ${sourceBadge} to ${targetBadge}`
    : `Translate this comment to ${targetLabel()}`;
}

function setButtonProgress(button, label) {
  if (!button) return;
  button.textContent = label;
}

async function getTranslator(sourceLanguage, button) {
  if (!('Translator' in self)) {
    throw new Error('Chrome Translator API is not available in this browser.');
  }

  const target = targetLanguage();
  const key = `${sourceLanguage}>${target}`;
  if (!translatorCache.has(key)) {
    const availability = await Translator.availability({
      sourceLanguage,
      targetLanguage: target,
    });
    if (availability === 'unavailable') {
      throw new Error(`Chrome cannot translate ${sourceLanguage} → ${targetLabel()} on this device.`);
    }

    const promise = Translator.create({
      sourceLanguage,
      targetLanguage: target,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const percent = Math.round(Number(event.loaded || 0) * 100);
          setButtonProgress(button, `Translate ${percent}%`);
        });
      },
    }).catch((error) => {
      translatorCache.delete(key);
      throw error;
    });
    translatorCache.set(key, promise);
  }
  return translatorCache.get(key);
}

async function translateComment(card, button) {
  const found = commentForCard(card);
  if (!found) return;

  if (found.comment.translationRu) {
    store.updateComment(found.sourceId, found.commentId, {
      translationShown: !Boolean(found.comment.translationShown),
    });
    renderCardTranslation(card);
    return;
  }

  if (found.comment.detectedLanguage === 'emoji') {
    renderCardTranslation(card);
    return;
  }

  button.disabled = true;
  setButtonProgress(button, 'Translate…');

  try {
    let sourceLanguage = String(
      found.comment.detectedLanguage || found.comment.translationSourceLanguage || ''
    ).toLowerCase();

    if (!sourceLanguage || sourceLanguage === 'general') {
      sourceLanguage = await detectTextLanguage(found.comment.text, {
        onProgress(percent) {
          setButtonProgress(button, `Detect ${percent}%`);
        },
      });
      recordDetectedLanguage(
        found.sourceId,
        found.commentId,
        sourceLanguage,
        sourceLanguage === 'general' ? 'translate-undetermined' : 'translate'
      );
    }

    if (sourceLanguage === 'emoji') {
      renderCardTranslation(card);
      return;
    }

    if (sourceLanguage === 'general') {
      throw new Error('Could not reliably identify the comment language.');
    }

    const target = targetLanguage();
    let translated = found.comment.text;

    if (!sourceLanguage.startsWith(target)) {
      const translator = await getTranslator(sourceLanguage, button);
      translated = await translator.translate(found.comment.text);
    }

    store.updateComment(found.sourceId, found.commentId, {
      translationRu: translated,
      translationSourceLanguage: sourceLanguage,
      translationTargetLanguage: target,
      translationShown: true,
      translatedAt: new Date().toISOString(),
    });
    recordDetectedLanguage(found.sourceId, found.commentId, sourceLanguage, 'translate');
    renderCardTranslation(card);
  } catch (error) {
    console.error('[CC translate] failed', error);
    const current = store.getComment(found.sourceId, found.commentId);
    if (!current?.detectedLanguage) {
      recordDetectedLanguage(found.sourceId, found.commentId, 'general', 'translate-failed');
    }
    showStatus(error?.message || `Could not translate this comment to ${targetLabel()}.`, 'error');
  } finally {
    button.disabled = false;
    renderCardTranslation(card);
  }
}

function bindCard(card) {
  if (!card) return;
  const actions = card.querySelector('.comment-actions');
  if (!actions) return;

  let button = actions.querySelector('.comment-translate-action');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'comment-translate-action';
    button.textContent = 'Translate';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      translateComment(card, button);
    });
    // App renders Highlight last, so appending places Translate directly after it.
    actions.appendChild(button);
  }

  renderCardTranslation(card);
}

function bindAll() {
  commentsList?.querySelectorAll('.comment-card').forEach(bindCard);
}

document.addEventListener('cc:language-updated', (event) => {
  const sourceId = event.detail?.sourceId;
  const commentId = event.detail?.commentId;
  if (!sourceId || !commentId || !commentsList) return;
  const card = [...commentsList.querySelectorAll('.comment-card')].find(
    (item) => item.dataset.sourceId === sourceId && item.dataset.commentId === commentId
  );
  if (card) renderCardTranslation(card);
});

document.addEventListener('cc:languages-updated', (event) => {
  const sourceId = event.detail?.sourceId;
  const commentIds = new Set(event.detail?.commentIds || []);
  if (!sourceId || !commentIds.size || !commentsList) return;

  commentsList.querySelectorAll('.comment-card').forEach((card) => {
    if (card.dataset.sourceId === sourceId && commentIds.has(card.dataset.commentId)) {
      renderCardTranslation(card);
    }
  });
});

ensureStyles();
if (commentsList) {
  new MutationObserver(bindAll).observe(commentsList, { childList: true });
}
bindAll();

console.info('[CC translate] configured per-comment local translation toggle ready');
