import { store } from './store.js';

const commentsList = document.querySelector('#comments-list');
const contentTitle = document.querySelector('#content-title');
const contentMeta = document.querySelector('#content-meta');

const detectorProgressListeners = new Set();
let detectorPromise = null;
let scanTimer = null;
let summaryFrame = null;
const scanningSources = new Set();
const rescanSources = new Set();

function normalizedLanguage(value) {
  return String(value || '').trim().toLowerCase();
}

function currentSourceId() {
  const activeId = document.querySelector('.source-item.is-active')?.dataset.sourceId;
  if (activeId) return activeId;
  try {
    return new URL(window.location.href).searchParams.get('source') || '';
  } catch {
    return '';
  }
}

function emojiGrapheme(value) {
  const text = String(value || '');
  if (!/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3)/u.test(text)) return false;
  return !/[^\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0e\ufe0f\u20e3#*0-9]/u.test(text);
}

export function isEmojiOnly(text) {
  const raw = String(text || '');
  if (!raw.trim()) return false;

  if (typeof Intl?.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const segments = [...segmenter.segment(raw)]
      .map((entry) => entry.segment)
      .filter((segment) => segment.trim());
    return segments.length > 0 && segments.every(emojiGrapheme);
  }

  const compact = raw.replace(/\s+/gu, '');
  if (!compact) return false;
  if (!/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3)/u.test(compact)) return false;
  return !/[^\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0e\ufe0f\u20e3#*0-9]/u.test(compact);
}

export function languageBadge(language) {
  const value = normalizedLanguage(language);
  if (!value) return '';
  if (value === 'emoji') return 'EMOJI';
  if (value === 'general') return 'GENERAL';
  return value.split('-')[0].toUpperCase();
}

export function languageLabel(language) {
  const value = normalizedLanguage(language);
  if (!value) return '';
  if (value === 'emoji') return 'Emoji';
  if (value === 'general') return 'General';

  const base = value.split('-')[0];
  try {
    const displayNames = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' });
    return displayNames.of(base) || base.toUpperCase();
  } catch {
    return base.toUpperCase();
  }
}

function getImmediateLanguage(text) {
  if (isEmojiOnly(text)) return 'emoji';
  if (!/\p{L}/u.test(String(text || ''))) return 'general';
  return '';
}

async function getDetector(onProgress) {
  if (!('LanguageDetector' in self)) {
    const error = new Error('Chrome Language Detector API is not available in this browser.');
    error.code = 'LANGUAGE_DETECTOR_UNAVAILABLE';
    throw error;
  }

  if (typeof onProgress === 'function') detectorProgressListeners.add(onProgress);

  if (!detectorPromise) {
    detectorPromise = LanguageDetector.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const percent = Math.round(Number(event.loaded || 0) * 100);
          detectorProgressListeners.forEach((listener) => {
            try { listener(percent); } catch {}
          });
        });
      },
    }).catch((error) => {
      detectorPromise = null;
      throw error;
    });
  }

  try {
    return await detectorPromise;
  } finally {
    if (typeof onProgress === 'function') detectorProgressListeners.delete(onProgress);
  }
}

export async function detectTextLanguage(text, { onProgress } = {}) {
  const immediate = getImmediateLanguage(text);
  if (immediate) return immediate;

  const detector = await getDetector(onProgress);
  const results = await detector.detect(String(text || '').slice(0, 12000));
  const best = Array.isArray(results) ? results[0] : null;
  const language = normalizedLanguage(best?.detectedLanguage);
  const confidence = Number(best?.confidence);

  if (!language || language === 'und') return 'general';
  if (Number.isFinite(confidence) && confidence < 0.35) return 'general';
  return language;
}

export function recordDetectedLanguage(sourceId, commentId, language, method = 'detector') {
  const normalized = normalizedLanguage(language) || 'general';
  const comment = store.getComment(sourceId, commentId);
  if (!comment) return null;

  const updated = store.updateComment(sourceId, commentId, {
    detectedLanguage: normalized,
    languageDetectionMethod: method,
    languageDetectedAt: new Date().toISOString(),
  });

  scheduleSummary();
  document.dispatchEvent(new CustomEvent('cc:language-updated', {
    detail: { sourceId, commentId, language: normalized },
  }));
  return updated;
}

function ensureSummaryNode() {
  if (!contentMeta) return null;
  let node = document.querySelector('#source-language-summary');
  if (!node) {
    node = document.createElement('p');
    node.id = 'source-language-summary';
    node.className = 'content-meta source-language-summary';
    contentMeta.insertAdjacentElement('afterend', node);
  }
  return node;
}

function renderSummary() {
  const node = ensureSummaryNode();
  if (!node) return;

  const sourceId = currentSourceId();
  const source = sourceId ? store.getSource(sourceId) : null;
  if (!source) {
    node.hidden = true;
    node.textContent = '';
    return;
  }

  const comments = store.getComments(sourceId);
  if (!comments.length) {
    node.hidden = true;
    node.textContent = '';
    return;
  }

  const counts = new Map();
  let pending = 0;

  comments.forEach((comment) => {
    const language = normalizedLanguage(comment.detectedLanguage || comment.translationSourceLanguage);
    if (!language) {
      pending += 1;
      return;
    }
    counts.set(language, (counts.get(language) || 0) + 1);
  });

  const languages = [...counts.entries()]
    .filter(([language]) => language !== 'emoji' && language !== 'general')
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const parts = [`Languages · ${languages.length}`];
  languages.forEach(([language, count]) => parts.push(`${languageBadge(language)} ${count}`));

  const emojiCount = counts.get('emoji') || 0;
  const generalCount = counts.get('general') || 0;
  if (emojiCount) parts.push(`Emoji ${emojiCount}`);
  if (generalCount) parts.push(`General ${generalCount}`);
  if (pending) parts.push(`Pending ${pending}`);

  node.hidden = false;
  node.textContent = parts.join(' · ');
  node.title = `Language statistics for ${comments.length} loaded comments. Pending comments have not been classified yet.`;
}

function scheduleSummary() {
  if (summaryFrame) cancelAnimationFrame(summaryFrame);
  summaryFrame = requestAnimationFrame(() => {
    summaryFrame = null;
    renderSummary();
  });
}

async function scanSource(sourceId) {
  if (!sourceId || !store.getSource(sourceId)) return;
  if (scanningSources.has(sourceId)) {
    rescanSources.add(sourceId);
    return;
  }

  scanningSources.add(sourceId);
  try {
    const comments = store.getComments(sourceId);
    let processed = 0;

    for (const comment of comments) {
      if (comment.detectedLanguage) continue;

      if (comment.translationSourceLanguage) {
        recordDetectedLanguage(sourceId, comment.id, comment.translationSourceLanguage, 'translation-cache');
        continue;
      }

      const immediate = getImmediateLanguage(comment.text);
      if (immediate) {
        recordDetectedLanguage(sourceId, comment.id, immediate, immediate === 'emoji' ? 'emoji' : 'rule');
        continue;
      }

      if (!('LanguageDetector' in self)) continue;

      try {
        const language = await detectTextLanguage(comment.text);
        recordDetectedLanguage(sourceId, comment.id, language, language === 'general' ? 'detector-low-confidence' : 'detector');
      } catch (error) {
        console.warn('[CC language] automatic detection failed', { commentId: comment.id, error });
      }

      processed += 1;
      if (processed % 8 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } finally {
    scanningSources.delete(sourceId);
    scheduleSummary();
    if (rescanSources.delete(sourceId)) {
      setTimeout(() => scanSource(sourceId), 0);
    }
  }
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    const sourceId = currentSourceId();
    if (!sourceId) {
      scheduleSummary();
      return;
    }
    scanSource(sourceId);
  }, 80);
}

if (commentsList) {
  new MutationObserver(scheduleScan).observe(commentsList, { childList: true });
}
if (contentTitle) {
  new MutationObserver(scheduleScan).observe(contentTitle, { childList: true, characterData: true, subtree: true });
}

document.addEventListener('click', (event) => {
  if (event.target.closest?.('.source-item, [data-open-source], #main-nav .nav-item, .brand')) {
    scheduleScan();
  }
});

window.addEventListener('popstate', scheduleScan);
document.addEventListener('cc:language-updated', scheduleSummary);

scheduleScan();
scheduleSummary();

console.info('[CC language] local language classification and summary ready');
