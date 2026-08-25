import { store } from './store.js';

const commentsList = document.querySelector('#comments-list');
const statusBanner = document.querySelector('#status-banner');
const TARGET_LANGUAGE = 'ru';
const translatorCache = new Map();
let detectorPromise = null;

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
  textNode.textContent = shown ? found.comment.translationRu : found.comment.text;
  textNode.style.whiteSpace = 'pre-line';
  button.classList.toggle('is-active', shown);
  button.setAttribute('aria-pressed', shown ? 'true' : 'false');
  button.title = shown ? 'Show original text' : 'Translate this comment to Russian';
}

function setButtonProgress(button, label) {
  if (!button) return;
  button.textContent = label;
}

async function getDetector(button) {
  if (!('LanguageDetector' in self)) {
    throw new Error('Chrome Language Detector API is not available in this browser.');
  }
  if (!detectorPromise) {
    detectorPromise = LanguageDetector.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const percent = Math.round(Number(event.loaded || 0) * 100);
          setButtonProgress(button, `Translate ${percent}%`);
        });
      },
    }).catch((error) => {
      detectorPromise = null;
      throw error;
    });
  }
  return detectorPromise;
}

async function detectLanguage(text, button) {
  const detector = await getDetector(button);
  const results = await detector.detect(String(text || '').slice(0, 12000));
  const best = Array.isArray(results) ? results[0] : null;
  const language = String(best?.detectedLanguage || '').toLowerCase();
  if (!language || language === 'und') throw new Error('Could not reliably detect the comment language.');
  return language;
}

async function getTranslator(sourceLanguage, button) {
  if (!('Translator' in self)) {
    throw new Error('Chrome Translator API is not available in this browser.');
  }

  const key = `${sourceLanguage}>${TARGET_LANGUAGE}`;
  if (!translatorCache.has(key)) {
    const availability = await Translator.availability({
      sourceLanguage,
      targetLanguage: TARGET_LANGUAGE,
    });
    if (availability === 'unavailable') {
      throw new Error(`Chrome cannot translate ${sourceLanguage} → Russian on this device.`);
    }

    const promise = Translator.create({
      sourceLanguage,
      targetLanguage: TARGET_LANGUAGE,
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

  // Once translated, the button is a simple Russian/original toggle. The
  // translation itself remains cached in the comment's local CC state.
  if (found.comment.translationRu) {
    store.updateComment(found.sourceId, found.commentId, {
      translationShown: !Boolean(found.comment.translationShown),
    });
    renderCardTranslation(card);
    return;
  }

  const originalLabel = 'Translate';
  button.disabled = true;
  setButtonProgress(button, 'Translate…');

  try {
    const sourceLanguage = await detectLanguage(found.comment.text, button);
    let translated = found.comment.text;

    if (!sourceLanguage.startsWith('ru')) {
      const translator = await getTranslator(sourceLanguage, button);
      translated = await translator.translate(found.comment.text);
    }

    store.updateComment(found.sourceId, found.commentId, {
      translationRu: translated,
      translationSourceLanguage: sourceLanguage,
      translationShown: true,
      translatedAt: new Date().toISOString(),
    });
    renderCardTranslation(card);
  } catch (error) {
    console.error('[CC translate] failed', error);
    showStatus(error?.message || 'Could not translate this comment to Russian.', 'error');
  } finally {
    button.disabled = false;
    setButtonProgress(button, originalLabel);
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

ensureStyles();
if (commentsList) {
  new MutationObserver(bindAll).observe(commentsList, { childList: true });
}
bindAll();

console.info('[CC translate] per-comment Russian translation toggle ready');
