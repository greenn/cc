import { checkHelper } from './helper-client.js';

const $ = (selector) => document.querySelector(selector);
const button = $('#helper-check');
const status = $('#helper-status');
const settingsButton = $('#settings-button');

const helperHeading = Array.from(document.querySelectorAll('strong'))
  .find((element) => element.textContent?.trim() === 'CC Browser Helper');

const badge = document.createElement('span');
badge.id = 'helper-live-badge';
badge.textContent = 'Checking…';
badge.title = 'Live connection status between this CC page and CC Browser Helper';
badge.style.cssText = [
  'display:inline-flex',
  'align-items:center',
  'margin-left:8px',
  'padding:2px 7px',
  'border-radius:999px',
  'font-size:10px',
  'font-weight:700',
  'vertical-align:1px',
  'background:#f2f2f2',
  'color:#666',
  'border:1px solid #ddd',
].join(';');
helperHeading?.after(badge);

function setBadge(message, kind = 'checking') {
  badge.textContent = message;
  if (kind === 'success') {
    badge.style.background = '#e9f8ee';
    badge.style.color = '#176b2c';
    badge.style.borderColor = '#a9d9b8';
  } else if (kind === 'error') {
    badge.style.background = '#fff0f0';
    badge.style.color = '#a32222';
    badge.style.borderColor = '#efb8b8';
  } else {
    badge.style.background = '#f2f2f2';
    badge.style.color = '#666';
    badge.style.borderColor = '#ddd';
  }
}

function show(message, kind = 'info') {
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
  status.style.background = kind === 'success' ? '#f0fff4' : kind === 'error' ? '#fff2f2' : '#f7f7f7';
  status.style.color = kind === 'success' ? '#176b2c' : kind === 'error' ? '#a32222' : '#555';
}

async function runCheck({ verbose = false } = {}) {
  setBadge('Checking…');
  if (verbose) show('Looking for CC Browser Helper…');

  try {
    const result = await checkHelper();
    const capabilities = Array.isArray(result?.capabilities) ? result.capabilities.join(', ') : 'unknown';
    const version = result?.version || '?';
    setBadge(`Connected v${version}`, 'success');
    if (verbose) show(`Helper connected · v${version} · ${capabilities}`, 'success');
    return result;
  } catch (error) {
    setBadge('Not connected', 'error');
    if (verbose) {
      show(`Helper not found: ${error.message || error}. If the extension is installed, reload it in chrome://extensions and refresh this CC tab.`, 'error');
    }
    throw error;
  }
}

button?.addEventListener('click', async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    await runCheck({ verbose: true });
  } catch {
    // The visible badge and status box already explain the failure.
  } finally {
    button.disabled = false;
    button.textContent = 'Check helper';
  }
});

settingsButton?.addEventListener('click', () => {
  window.setTimeout(() => {
    runCheck().catch(() => {});
  }, 50);
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== 'cc-helper' || message.type !== 'CC_HELPER_READY') return;
  setBadge(`Connected v${message.version || '?'}`, 'success');
});

window.setTimeout(() => {
  runCheck().catch(() => {});
}, 150);
