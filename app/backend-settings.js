import { store } from './store.js';

const DEFAULT_BACKEND_URL = 'https://backend83.nadube.ru/cc';
const LEGACY_BACKEND_URLS = new Set([
  'https://cdn.nadube.ru/dv/cc/backend',
  'https://backend.nadube.ru/cc',
]);

const $ = (selector) => document.querySelector(selector);

const backendUrl = $('#backend-url');
const backendToken = $('#backend-token');
const backendProfile = $('#backend-profile');
const backendCheck = $('#backend-check');
const backendStatus = $('#backend-status');
const settingsButton = $('#settings-button');
const settingsForm = $('#settings-form');

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function effectiveBackendUrl(settings) {
  const configured = normalizeBaseUrl(settings?.backendUrl || '');
  if (!configured || LEGACY_BACKEND_URLS.has(configured)) return DEFAULT_BACKEND_URL;
  return configured;
}

function showBackendStatus(message, kind = 'info') {
  if (!backendStatus) return;
  backendStatus.hidden = false;
  backendStatus.textContent = message;
  backendStatus.style.background = kind === 'success' ? '#f0fff4' : kind === 'error' ? '#fff2f2' : '#f7f7f7';
  backendStatus.style.color = kind === 'success' ? '#176b2c' : kind === 'error' ? '#a32222' : '#555';
}

function fillBackendSettings() {
  const settings = store.getSettings();
  const resolvedUrl = effectiveBackendUrl(settings);
  const configured = normalizeBaseUrl(settings.backendUrl || '');

  if (LEGACY_BACKEND_URLS.has(configured)) {
    store.setSettings({ backendUrl: DEFAULT_BACKEND_URL });
  }

  if (backendUrl) backendUrl.value = resolvedUrl;
  if (backendToken) backendToken.value = settings.backendToken || '';
  if (backendProfile) backendProfile.value = settings.backendProfile || 'default';
  if (backendStatus) {
    backendStatus.hidden = true;
    backendStatus.textContent = '';
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function checkBackend() {
  const base = normalizeBaseUrl(backendUrl?.value || DEFAULT_BACKEND_URL);
  const token = backendToken?.value.trim() || '';
  const profile = backendProfile?.value.trim() || 'default';

  if (!base.startsWith('https://') && !base.startsWith('http://localhost') && !base.startsWith('http://127.0.0.1')) {
    showBackendStatus('Use an HTTPS backend URL.', 'error');
    return;
  }

  backendCheck.disabled = true;
  backendCheck.textContent = 'Checking…';
  showBackendStatus('Checking server…');

  try {
    const healthResponse = await fetch(`${base}/api/health.php`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const health = await readJson(healthResponse);

    if (!healthResponse.ok || !health.ok) {
      throw new Error(health.error || `Health check failed (${healthResponse.status})`);
    }

    if (!token) {
      showBackendStatus(`Server connected. PHP ${health.php || '?'} · SQLite ${health.sqlite || '?'}. Add the API token to test storage access.`, 'success');
      return;
    }

    const stateResponse = await fetch(`${base}/api/state.php?profile=${encodeURIComponent(profile)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    const state = await readJson(stateResponse);

    if (!stateResponse.ok || !state.ok) {
      throw new Error(state.error || `Storage authorization failed (${stateResponse.status})`);
    }

    showBackendStatus(`Connected. PHP ${health.php || '?'} · SQLite ${health.sqlite || '?'} · storage authorized · profile “${profile}”.`, 'success');
  } catch (error) {
    showBackendStatus(`Connection failed: ${error.message || error}`, 'error');
  } finally {
    backendCheck.disabled = false;
    backendCheck.textContent = 'Check connection';
  }
}

settingsButton?.addEventListener('click', () => {
  fillBackendSettings();
});

settingsForm?.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  store.setSettings({
    backendUrl: normalizeBaseUrl(backendUrl?.value || DEFAULT_BACKEND_URL),
    backendToken: backendToken?.value.trim() || '',
    backendProfile: backendProfile?.value.trim() || 'default',
  });
});

backendCheck?.addEventListener('click', (event) => {
  event.preventDefault();
  checkBackend();
});

fillBackendSettings();
