import { store } from './store.js';

const MODEL = 'large-v3';
const ACTIVE_STATUSES = new Set(['queued', 'running']);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function currentSource() {
  const active = document.querySelector('.source-item.is-active');
  if (!active?.dataset.sourceId) return null;
  return store.getSource(active.dataset.sourceId);
}

function largeResult(source) {
  return source?.transcripts && typeof source.transcripts === 'object'
    ? source.transcripts[MODEL] || null
    : null;
}

function largeJob(source) {
  return source?.transcriptionJobs && typeof source.transcriptionJobs === 'object'
    ? source.transcriptionJobs[MODEL] || null
    : null;
}

function isActive(job) {
  return Boolean(job && ACTIVE_STATUSES.has(job.status));
}

function shouldConfirmRepeat(source) {
  return Boolean(source && largeResult(source) && !isActive(largeJob(source)));
}

function confirmRepeat() {
  return window.confirm('Распознавание уже выполнено. Точно распознать заново?');
}

function normalizeRecognitionUi() {
  const group = $('#recognize-model-group');
  if (group) {
    $$('[data-recognize-model]').forEach((button) => {
      const isLarge = button.dataset.recognizeModel === MODEL;
      button.hidden = !isLarge;
      if (!isLarge) return;
      if (button.textContent !== 'Распознать') button.textContent = 'Распознать';
      button.title = 'Распознать видео через Whisper large-v3';
      button.setAttribute('aria-label', 'Распознать видео через Whisper large-v3');
    });
  }

  const dialogRun = $('#transcript-run');
  if (dialogRun && dialogRun.textContent !== 'Распознать') {
    dialogRun.textContent = 'Распознать';
  }
}

// Capture before transcript.js handlers. A completed large-v3 transcript may only
// be replaced after explicit confirmation from the user.
document.addEventListener('click', (event) => {
  const modelButton = event.target.closest?.('[data-recognize-model]');
  if (modelButton) {
    if (modelButton.dataset.recognizeModel !== MODEL) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const source = currentSource();
    if (shouldConfirmRepeat(source) && !confirmRepeat()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      normalizeRecognitionUi();
    }
    return;
  }

  const dialogRun = event.target.closest?.('#transcript-run');
  if (!dialogRun) return;
  const source = currentSource();
  if (shouldConfirmRepeat(source) && !confirmRepeat()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    normalizeRecognitionUi();
  }
}, true);

const observer = new MutationObserver(() => normalizeRecognitionUi());
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['hidden', 'class', 'disabled'],
});

normalizeRecognitionUi();
