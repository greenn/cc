import { store } from './store.js';

export const DEFAULT_WHISPER_URL = 'http://127.0.0.1:8787';
const $ = (selector) => document.querySelector(selector);

const settingsButton = $('#settings-button');
const settingsDialog = $('#settings-dialog');
const settingsForm = $('#settings-form');
const serviceUrlInput = $('#whisper-service-url');
const tokenInput = $('#whisper-service-token');
const checkButton = $('#whisper-check');
const statusBox = $('#whisper-status');
const indicator = $('#whisper-indicator');
const indicatorText = $('#whisper-indicator-text');
const sourcesList = $('#sources-list');

let lastStatus = {
  online: false,
  model: '',
  loadedModel: '',
  supportedModels: [],
  device: '',
  version: '',
  modelLoaded: false,
  activeJobs: 0,
  queuedJobs: 0,
  checkedAt: 0,
};

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function getLocalWhisperSettings() {
  const settings = store.getSettings();
  return {
    url: normalizeBaseUrl(settings.whisperServiceUrl || DEFAULT_WHISPER_URL),
    token: String(settings.whisperServiceToken || '').trim(),
  };
}

function localRequest(url, options = {}) {
  const init = { mode: 'cors', cache: 'no-store', ...options };
  try {
    return fetch(new Request(url, { ...init, targetAddressSpace: 'loopback' }));
  } catch {
    return fetch(url, init);
  }
}

function currentSourceIsYouTube() {
  const active = document.querySelector('.source-item.is-active');
  return active?.querySelector('.source-platform')?.textContent?.trim() === '▶';
}

function shouldPollWhisper() {
  return currentSourceIsYouTube() || Boolean(settingsDialog?.open);
}

function renderIndicator() {
  if (!indicator || !indicatorText) return;

  const shouldHide = !currentSourceIsYouTube();
  if (indicator.hidden !== shouldHide) indicator.hidden = shouldHide;
  indicator.classList.toggle('is-online', lastStatus.online);
  indicator.classList.toggle('is-offline', !lastStatus.online);

  const jobs = Number(lastStatus.activeJobs || 0) + Number(lastStatus.queuedJobs || 0);
  const nextText = lastStatus.online
    ? jobs > 0 ? `Whisper online · ${jobs} job${jobs === 1 ? '' : 's'}` : 'Whisper online'
    : 'Whisper offline';

  // Do not replace the text node when nothing changed. Replacing it on every
  // status poll destroys a user's active text selection and makes copy fail.
  if (indicatorText.textContent !== nextText) indicatorText.textContent = nextText;

  const loaded = lastStatus.loadedModel
    ? ` · loaded ${lastStatus.loadedModel}`
    : lastStatus.modelLoaded ? ' · model loaded' : ' · no model loaded yet';
  const nextTitle = lastStatus.online
    ? `Local Whisper is running${lastStatus.device ? ` · ${lastStatus.device}` : ''}${loaded}`
    : 'Local Whisper is not reachable.';
  if (indicator.title !== nextTitle) indicator.title = nextTitle;
}

function showStatus(message, kind = 'info') {
  if (!statusBox) return;
  statusBox.hidden = false;
  statusBox.textContent = message;
  statusBox.style.background = kind === 'success' ? '#f0fff4' : kind === 'error' ? '#fff2f2' : '#f7f7f7';
  statusBox.style.color = kind === 'success' ? '#176b2c' : kind === 'error' ? '#a32222' : '#555';
}

function dispatchStatus() {
  document.dispatchEvent(new CustomEvent('cc:whisper-status', { detail: { ...lastStatus } }));
}

function requestHeaders(includeJson = false) {
  const { token } = getLocalWhisperSettings();
  const headers = { Accept: 'application/json' };
  if (includeJson) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readLocalResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.detail || data.error || `${fallbackMessage} (${response.status}).`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function checkLocalWhisper({ quiet = false } = {}) {
  const { url } = getLocalWhisperSettings();
  if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
    lastStatus = { ...lastStatus, online: false, checkedAt: Date.now() };
    renderIndicator();
    dispatchStatus();
    if (!quiet) showStatus('For a local service use http://127.0.0.1:8787 or localhost.', 'error');
    return lastStatus;
  }

  let timer;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 2500);
    const response = await localRequest(`${url}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.detail || `HTTP ${response.status}`);

    lastStatus = {
      online: true,
      model: String(data.defaultModel || data.model || ''),
      loadedModel: String(data.loadedModel || ''),
      supportedModels: Array.isArray(data.supportedModels) ? data.supportedModels.map(String) : [],
      device: String(data.device || ''),
      version: String(data.version || ''),
      modelLoaded: Boolean(data.modelLoaded),
      activeJobs: Number(data.activeJobs || 0),
      queuedJobs: Number(data.queuedJobs || 0),
      checkedAt: Date.now(),
    };
    if (!quiet) {
      const loaded = lastStatus.loadedModel ? `loaded ${lastStatus.loadedModel}` : 'model loads on first recognition';
      showStatus(`Local Whisper connected · ${lastStatus.device || 'device ?'} · ${loaded}.`, 'success');
    }
  } catch (error) {
    lastStatus = {
      ...lastStatus,
      online: false,
      loadedModel: '',
      supportedModels: [],
      modelLoaded: false,
      activeJobs: 0,
      queuedJobs: 0,
      checkedAt: Date.now(),
    };
    if (!quiet) showStatus(`Local Whisper is offline: ${error.name === 'AbortError' ? 'connection timed out' : error.message || error}`, 'error');
  } finally {
    clearTimeout(timer);
  }

  renderIndicator();
  dispatchStatus();
  return lastStatus;
}

export async function createLocalWhisperJob(videoUrl, language = null, model = 'small') {
  const { url } = getLocalWhisperSettings();
  const response = await localRequest(`${url}/jobs`, {
    method: 'POST',
    headers: requestHeaders(true),
    body: JSON.stringify({ url: videoUrl, language, model }),
  });
  const data = await readLocalResponse(response, 'Could not start local Whisper job');
  if (!data.job?.id) throw new Error('Local Whisper did not return a job id.');
  return data.job;
}

export async function getLocalWhisperJob(jobId) {
  const { url } = getLocalWhisperSettings();
  const response = await localRequest(`${url}/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: requestHeaders(false),
  });
  const data = await readLocalResponse(response, 'Could not read local Whisper job');
  if (!data.job) throw new Error('Local Whisper returned an invalid job response.');
  return data.job;
}

export async function transcribeWithLocalWhisper(videoUrl, language = null, model = 'small') {
  const { url } = getLocalWhisperSettings();
  const response = await localRequest(`${url}/transcribe`, {
    method: 'POST',
    headers: requestHeaders(true),
    body: JSON.stringify({ url: videoUrl, language, model }),
  });
  return readLocalResponse(response, 'Local Whisper request failed');
}

function fillSettings({ check = true } = {}) {
  const settings = getLocalWhisperSettings();
  if (serviceUrlInput) serviceUrlInput.value = settings.url;
  if (tokenInput) tokenInput.value = settings.token;
  if (statusBox) {
    statusBox.hidden = true;
    statusBox.textContent = '';
  }
  if (check) checkLocalWhisper({ quiet: true });
}

settingsButton?.addEventListener('click', () => fillSettings({ check: true }));

settingsForm?.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  store.setSettings({
    whisperServiceUrl: normalizeBaseUrl(serviceUrlInput?.value || DEFAULT_WHISPER_URL),
    whisperServiceToken: tokenInput?.value.trim() || '',
  });
  setTimeout(() => checkLocalWhisper({ quiet: true }), 0);
});

checkButton?.addEventListener('click', async (event) => {
  event.preventDefault();
  store.setSettings({
    whisperServiceUrl: normalizeBaseUrl(serviceUrlInput?.value || DEFAULT_WHISPER_URL),
    whisperServiceToken: tokenInput?.value.trim() || '',
  });
  checkButton.disabled = true;
  checkButton.textContent = 'Checking…';
  await checkLocalWhisper();
  checkButton.disabled = false;
  checkButton.textContent = 'Check local Whisper';
});

if (sourcesList) {
  new MutationObserver(() => {
    const wasYouTube = !indicator?.hidden;
    renderIndicator();
    if (currentSourceIsYouTube() && (!wasYouTube || Date.now() - lastStatus.checkedAt > 15000)) {
      checkLocalWhisper({ quiet: true });
    }
  }).observe(sourcesList, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

document.addEventListener('click', (event) => {
  if (!event.target.closest?.('.source-item')) return;
  setTimeout(() => {
    renderIndicator();
    if (currentSourceIsYouTube() && Date.now() - lastStatus.checkedAt > 5000) {
      checkLocalWhisper({ quiet: true });
    }
  }, 0);
});

// Populate fields only. Do not contact 127.0.0.1 while the user is simply
// opening the title/Sources page.
fillSettings({ check: false });
renderIndicator();

setInterval(() => {
  if (document.visibilityState === 'visible' && shouldPollWhisper()) {
    checkLocalWhisper({ quiet: true });
  }
}, 15000);
