import { store } from './store.js';

const DEFAULT_BACKEND_URL = 'https://backend83.nadube.ru/cc';
const LEGACY_MARKER = 'server-managed';
const $ = (selector) => document.querySelector(selector);

const settingsButton = $('#settings-button');
const status = $('#vk-status');
const connectButton = $('#vk-connect');
const checkButton = $('#vk-check');

let pollTimer = null;
let pollDeadline = 0;

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function currentBackend() {
  const settings = store.getSettings();
  const urlInput = $('#backend-url');
  const tokenInput = $('#backend-token');
  const profileInput = $('#backend-profile');
  return {
    base: normalizeBaseUrl(urlInput?.value || settings.backendUrl || DEFAULT_BACKEND_URL),
    token: String(tokenInput?.value || settings.backendToken || '').trim(),
    profile: String(profileInput?.value || settings.backendProfile || 'default').trim() || 'default',
  };
}

function show(message, kind = 'info') {
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
  status.style.background = kind === 'success' ? '#f0fff4' : kind === 'error' ? '#fff2f2' : '#f7f7f7';
  status.style.color = kind === 'success' ? '#176b2c' : kind === 'error' ? '#a32222' : '#555';
}

function syncLegacyMarker(connected) {
  const current = String(store.getSettings().vkAccessToken || '');
  const next = connected ? LEGACY_MARKER : '';
  if (current !== next) store.setSettings({ vkAccessToken: next });
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

async function checkVkStatus({ quiet = false } = {}) {
  const { base, token, profile } = currentBackend();
  if (!token) {
    syncLegacyMarker(false);
    if (!quiet) show('Configure the PHP backend API token first, then connect VK.', 'error');
    return null;
  }

  if (!quiet) show('Checking VK connection…');
  try {
    const response = await fetch(`${base}/api/vk-status.php?profile=${encodeURIComponent(profile)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    const data = await readJson(response);
    if (!response.ok || !data.ok) throw new Error(data.error || `VK status failed (${response.status}).`);

    syncLegacyMarker(Boolean(data.connected));
    if (data.connected) {
      const user = data.userId ? ` · VK user ${data.userId}` : '';
      const refresh = data.autoRefresh ? ' · automatic refresh ON' : ' · automatic refresh unavailable';
      show(`VK connected${user}${refresh}`, data.autoRefresh ? 'success' : 'error');
    } else if (!quiet) {
      show('VK is not connected to this CC profile yet.');
    }
    return data;
  } catch (error) {
    syncLegacyMarker(false);
    if (!quiet) show(`VK check failed: ${error.message || error}`, 'error');
    return null;
  }
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  pollDeadline = 0;
}

function startPolling() {
  stopPolling();
  pollDeadline = Date.now() + 120000;
  pollTimer = setInterval(async () => {
    const data = await checkVkStatus({ quiet: true });
    if (data?.connected) {
      stopPolling();
      const user = data.userId ? ` · VK user ${data.userId}` : '';
      show(`VK connected${user} · automatic refresh ${data.autoRefresh ? 'ON' : 'unavailable'}`, data.autoRefresh ? 'success' : 'error');
      const activeVkSource = document.querySelector('.source-item.is-active[data-source-id^="vk:"]');
      if (activeVkSource && !document.querySelector('#refresh-button')?.hidden) {
        document.querySelector('#refresh-button')?.click();
      }
    } else if (Date.now() > pollDeadline) {
      stopPolling();
      show('VK authorization window is still open or was cancelled. Use Check VK after finishing authorization.');
    }
  }, 2500);
}

async function connectVk(event) {
  event?.preventDefault();
  const { base, token, profile } = currentBackend();
  if (!token) {
    show('Configure the PHP backend API token first.', 'error');
    return;
  }

  connectButton.disabled = true;
  connectButton.textContent = 'Opening VK…';
  show('Creating a protected VK connection link…');

  try {
    const response = await fetch(`${base}/api/vk-connect.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ profile }),
      cache: 'no-store',
    });
    const data = await readJson(response);
    if (!response.ok || !data.ok || !data.connectUrl) {
      throw new Error(data.error || `Could not start VK connection (${response.status}).`);
    }

    const authWindow = window.open(data.connectUrl, '_blank', 'noopener');
    if (!authWindow) throw new Error('Browser blocked the VK authorization window. Allow pop-ups for CC and try again.');
    show('VK authorization opened in a new tab. Finish it there; CC will detect the connection automatically.');
    startPolling();
  } catch (error) {
    show(`VK connection failed: ${error.message || error}`, 'error');
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = 'Connect VK';
  }
}

connectButton?.addEventListener('click', connectVk);
checkButton?.addEventListener('click', (event) => {
  event.preventDefault();
  checkVkStatus();
});
settingsButton?.addEventListener('click', () => {
  setTimeout(() => checkVkStatus(), 0);
});

// Remove any old real VK token from browser storage. From 0.3.7 onward the
// access/refresh tokens live only on the PHP backend.
if (String(store.getSettings().vkAccessToken || '').startsWith('vk')) {
  store.setSettings({ vkAccessToken: '' });
}

setTimeout(() => checkVkStatus({ quiet: true }), 400);
