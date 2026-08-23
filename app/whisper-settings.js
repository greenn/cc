import { store } from './store.js';

export const DEFAULT_WHISPER_URL = 'http://127.0.0.1:8787';
const $ = (selector) => document.querySelector(selector);

const settingsButton = $('#settings-button');
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

function renderIndicator() {
  if (!indicator || !indicatorText) return;
  indicator.hidden = !currentSourceIsYouTube();
  indicator.classList.toggle('is-online', lastStatus.online);
  indicator.classList.toggle('is-offline', !lastStatus.online);

  const jobs = Number(lastStatus.activeJobs || 0) + Number(lastStatus.queuedJobs || 0);
  indicatorText.textContent = lastStatus.online
    ? jobs > 0 ? `Whisper online · ${jobs} job${jobs === 1 ? '' : 's'}` : 'Whisper online'
    : 'Whisper offline';

  indicator.title = lastStatus.online
    ? `Local Whisper is running${lastStatus.model ? ` · ${lastStatus.model}` : ''}${lastStatus.device ? ` · ${lastStatus.device}` : ''}${lastStatus.modelLoaded ? ' · model loaded' : ' · model not loaded yet'}`
    : 'Local Whisper is not reachable. YouTube captions can still be used.';
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
      model: String(data.model || ''),
      device: String(data.device || ''),
      version: String(data.version || ''),
      modelLoaded: Boolean(data.modelLoaded),
      activeJobs: Number(data.activeJobs || 0),
      queuedJobs: Number(data.queuedJobs || 0),
      checkedAt: Date.now(),
    };
    if (!quiet) {
      const loaded = lastStatus.modelLoaded ? 'model loaded' : 'model loads on first recognition';
      showStatus(`Local Whisper connected · ${lastStatus.model || 'model ?'} · ${lastStatus.device || 'device ?'} · ${loaded}.`, 'success');
    }
  } catch (error) {
    lastStatus = {
      ...lastStatus,
      online: false,
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

export async function createLocalWhisperJob(videoUrl, language = null) {
  const { url } = getLocalWhisperSettings();
  const response = await localRequest(`${url}/jobs`, {
    method: 'POST',
    headers: requestHeaders(true),
    body: JSON.stringify({ url: videoUrl, language }),
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

export async function transcribeWithLocalWhisper(videoUrl, language = null) {
  const { url } = getLocalWhisperSettings();
  const response = await localRequest(`${url}/transcribe`, {
    method: 'POST',
    headers: requestHeaders(true),
    body: JSON.stringify({ url: videoUrl, language }),
  });
  return readLocalResponse(response, 'Local Whisper request failed');
}

function fillSettings() {
  const settings = getLocalWhisperSettings();
  if (serviceUrlInput) serviceUrlInput.value = settings.url;
  if (tokenInput) tokenInput.value = settings.token;
  if (statusBox) {
    statusBox.hidden = true;
    statusBox.textContent = '';
  }
  checkLocalWhisper({ quiet: true });
}

settingsButton?.addEventListener('click', fillSettings);

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
  new MutationObserver(renderIndicator).observe(sourcesList, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

document.addEventListener('click', () => setTimeout(renderIndicator, 0));
fillSettings();
setInterval(() => {
  if (document.visibilityState === 'visible') checkLocalWhisper({ quiet: true });
}, 15000);
