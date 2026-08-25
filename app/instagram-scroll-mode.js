import { store } from './store.js';
import { instagramAdapter } from './platforms/instagram.js';

const SETTING_KEY = 'instagramPageDownOnly';
const SENTINEL = 10000;

function ensureSettingUi() {
  const helperStatus = document.querySelector('#helper-status');
  const helperCheck = document.querySelector('#helper-check');
  if (!helperStatus || !helperCheck || document.querySelector('#instagram-pagedown-only')) return;

  const anchor = helperCheck.parentElement || helperStatus;
  const row = document.createElement('label');
  row.className = 'instagram-pagedown-setting';
  row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin:8px 0 2px;font-size:12px;line-height:1.35;cursor:pointer';
  row.innerHTML = `
    <input id="instagram-pagedown-only" type="checkbox" style="margin-top:2px" />
    <span><strong style="font-size:12px">PageDown only (experimental)</strong><br><span style="color:#777">During Instagram Refresh / Load more, move through the Comments panel only with PageDown-style steps instead of the normal mixed scroll/load-more strategy. This is useful for testing Instagram's own lazy loading; it works best while the temporary Instagram worker tab is actually focused.</span></span>`;
  anchor.insertAdjacentElement('afterend', row);
}

function syncSettingUi() {
  ensureSettingUi();
  const checkbox = document.querySelector('#instagram-pagedown-only');
  if (checkbox) checkbox.checked = Boolean(store.getSettings()?.[SETTING_KEY]);
}

function saveSettingFromUi() {
  const checkbox = document.querySelector('#instagram-pagedown-only');
  if (!checkbox) return;
  store.setSettings({ [SETTING_KEY]: Boolean(checkbox.checked) });
}

const settingsButton = document.querySelector('#settings-button');
settingsButton?.addEventListener('click', () => window.setTimeout(syncSettingUi, 0));

document.querySelector('#settings-form')?.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  saveSettingFromUi();
});

if (!instagramAdapter.__ccPageDownSettingWrapped) {
  const originalGetComments = instagramAdapter.getComments.bind(instagramAdapter);
  instagramAdapter.getComments = (source, cursor, options = {}) => {
    const nextOptions = { ...(options || {}) };
    if (store.getSettings()?.[SETTING_KEY]) {
      const normalBudget = Math.max(1, Math.min(9999, Number(nextOptions.maxClicks || 40)));
      nextOptions.maxClicks = SENTINEL + normalBudget;
    }
    return originalGetComments(source, cursor, nextOptions);
  };
  instagramAdapter.__ccPageDownSettingWrapped = true;
}

syncSettingUi();
console.info('[CC Instagram scroll mode] PageDown-only experimental setting ready');
