import { checkHelper } from './helper-client.js';

const $ = (selector) => document.querySelector(selector);
const button = $('#helper-check');
const status = $('#helper-status');

function show(message, kind = 'info') {
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
  status.style.background = kind === 'success' ? '#f0fff4' : kind === 'error' ? '#fff2f2' : '#f7f7f7';
  status.style.color = kind === 'success' ? '#176b2c' : kind === 'error' ? '#a32222' : '#555';
}

button?.addEventListener('click', async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = 'Checking…';
  show('Looking for CC Browser Helper…');
  try {
    const result = await checkHelper();
    const capabilities = Array.isArray(result?.capabilities) ? result.capabilities.join(', ') : 'unknown';
    show(`Helper connected · v${result?.version || '?'} · ${capabilities}`, 'success');
  } catch (error) {
    show(`Helper not found: ${error.message || error}. Install helper/chrome as an unpacked Chrome extension.`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Check helper';
  }
});
