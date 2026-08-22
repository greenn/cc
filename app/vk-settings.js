import { store } from './store.js';

const $ = (selector) => document.querySelector(selector);
const tokenInput = $('#vk-access-token');
const settingsButton = $('#settings-button');
const settingsForm = $('#settings-form');

function fillVkSettings() {
  if (tokenInput) tokenInput.value = store.getSettings().vkAccessToken || '';
}

settingsButton?.addEventListener('click', fillVkSettings);
settingsForm?.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  store.setSettings({ vkAccessToken: tokenInput?.value.trim() || '' });
});

fillVkSettings();
