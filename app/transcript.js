import { store } from './store.js';
import { checkLocalWhisper, transcribeWithLocalWhisper } from './whisper-settings.js';

const DEFAULT_BACKEND_URL = 'https://backend83.nadube.ru/cc';
const $ = (selector) => document.querySelector(selector);

const button = $('#transcribe-button');
const dialog = $('#transcript-dialog');
const title = $('#transcript-title');
const meta = $('#transcript-meta');
const output = $('#transcript-text');
const errorBox = $('#transcript-error');
const runButton = $('#transcript-run');
const copyButton = $('#transcript-copy');
const sourcesList = $('#sources-list');

let activeSourceId = null;
let running = false;

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function currentSource() {
  const active = document.querySelector('.source-item.is-active');
  if (!active?.dataset.sourceId) return null;
  return store.getSource(active.dataset.sourceId);
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function renderTranscript(source) {
  title.textContent = source?.title || 'YouTube transcript';
  const segments = Array.isArray(source?.transcriptSegments) ? source.transcriptSegments : [];
  const method = source?.transcriptMethod === 'whisper'
    ? 'Local Whisper'
    : source?.transcriptMethod === 'captions'
      ? 'YouTube captions'
      : 'Transcript';
  const language = source?.transcriptLanguage ? ` · ${source.transcriptLanguage}` : '';
  const generated = source?.transcriptGenerated && source?.transcriptMethod === 'captions' ? ' · auto-generated captions' : '';
  meta.textContent = `${method}${language}${generated}${segments.length ? ` · ${segments.length} segments` : ''}`;

  if (segments.length) {
    output.value = segments.map((segment) => `[${formatTime(segment.start)}] ${segment.text}`).join('\n');
  } else {
    output.value = source?.transcript || '';
  }

  copyButton.disabled = !output.value;
  runButton.textContent = source?.transcript ? 'Recognize again' : 'Recognize';
}

function setError(message = '') {
  errorBox.hidden = !message;
  errorBox.textContent = message;
}

function syncButton() {
  const source = currentSource();
  const isYouTube = source?.platform === 'youtube';
  button.hidden = !isYouTube;
  activeSourceId = isYouTube ? source.id : null;
  if (!isYouTube) return;
  const label = running ? 'Recognizing…' : source.transcript ? 'Transcript' : 'Recognize video';
  if (button.textContent !== label) button.textContent = label;
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function saveTranscript(source, data) {
  store.updateSource(source.id, {
    transcript: data.text || '',
    transcriptSegments: Array.isArray(data.segments) ? data.segments : [],
    transcriptMethod: data.method || 'captions',
    transcriptLanguage: data.language || '',
    transcriptGenerated: Boolean(data.generated),
    transcriptUpdatedAt: new Date().toISOString(),
  });
  renderTranscript(store.getSource(source.id));
}

async function localWhisperFallback(source) {
  meta.textContent = 'No usable YouTube captions. Checking local Whisper…';
  const status = await checkLocalWhisper({ quiet: true });
  if (!status.online) {
    throw new Error('This video has no usable YouTube captions and local Whisper is offline. Start start-whisper.cmd on this computer.');
  }

  meta.textContent = `Local Whisper is recognizing the audio · ${status.model || 'model'} · ${status.device || 'device'}…`;
  const local = await transcribeWithLocalWhisper(source.url, null);
  return {
    ...local,
    ok: true,
    method: 'whisper',
    generated: true,
  };
}

async function recognize(source) {
  if (!source || source.platform !== 'youtube' || running) return;

  const settings = store.getSettings();
  const base = normalizeBaseUrl(settings.backendUrl || DEFAULT_BACKEND_URL);
  const token = String(settings.backendToken || '').trim();

  running = true;
  runButton.disabled = true;
  button.disabled = true;
  runButton.textContent = 'Recognizing…';
  syncButton();
  setError('');

  try {
    if (!token) {
      meta.textContent = 'Backend token is not configured. Using local Whisper directly…';
      const data = await localWhisperFallback(source);
      saveTranscript(source, data);
      return;
    }

    meta.textContent = 'Checking YouTube captions first…';
    const response = await fetch(`${base}/api/transcript.php`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        videoId: source.externalId,
        url: source.url,
        preferredLanguages: ['ru', 'en'],
        captionsOnly: true,
      }),
    });
    let data = await readJson(response);

    if (!response.ok || !data.ok) {
      const captionsUnavailable = data.code === 'captions_unavailable'
        || data.code === 'whisper_not_configured'
        || String(data.error || '').includes('no YouTube captions')
        || String(data.error || '').includes('empty or unsupported caption track');
      const backendUnavailable = response.status === 404 || response.status === 405 || response.status >= 500;

      if (!captionsUnavailable && !backendUnavailable) {
        throw new Error(data.error || `Transcript request failed (${response.status}).`);
      }

      data = await localWhisperFallback(source);
    }

    saveTranscript(source, data);
  } finally {
    running = false;
    runButton.disabled = false;
    button.disabled = false;
    syncButton();
  }
}

button?.addEventListener('click', async () => {
  const source = currentSource();
  if (!source || source.platform !== 'youtube') return;
  activeSourceId = source.id;
  setError('');
  renderTranscript(source);
  dialog.showModal();

  if (!source.transcript) {
    try {
      await recognize(source);
    } catch (error) {
      setError(error.message || 'Could not recognize this video.');
      renderTranscript(store.getSource(source.id));
    }
  }
});

runButton?.addEventListener('click', async (event) => {
  event.preventDefault();
  const source = store.getSource(activeSourceId) || currentSource();
  try {
    await recognize(source);
  } catch (error) {
    setError(error.message || 'Could not recognize this video.');
    renderTranscript(store.getSource(source?.id));
  }
});

copyButton?.addEventListener('click', async (event) => {
  event.preventDefault();
  if (!output.value) return;
  try {
    await navigator.clipboard.writeText(output.value);
    copyButton.textContent = 'Copied';
    setTimeout(() => { copyButton.textContent = 'Copy text'; }, 1200);
  } catch {
    output.focus();
    output.select();
  }
});

if (sourcesList) {
  new MutationObserver(syncButton).observe(sourcesList, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

document.addEventListener('click', () => setTimeout(syncButton, 0));
syncButton();
