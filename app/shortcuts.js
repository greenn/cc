import { store } from './store.js';

const buttonHost = document.querySelector('.left-bottom');
const settingsButton = document.querySelector('#settings-button');
const contentArea = document.querySelector('#content-area');
const SETTING_KEY = 'commentShortcutsEnabled';

function isEnabled() {
  return Boolean(store.getSettings()?.[SETTING_KEY]);
}

function legend(enabled = isEnabled()) {
  return [
    `Shortcuts ${enabled ? 'ON' : 'OFF'}`,
    '← Delete comment',
    '→ Save comment',
    'Target: selected comment; otherwise the top visible comment',
  ].join('\n');
}

function updateButton() {
  const button = document.querySelector('#shortcuts-button');
  if (!button) return;
  const enabled = isEnabled();
  button.classList.toggle('is-active', enabled);
  button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  button.title = legend(enabled);
}

function installButton() {
  if (!buttonHost || document.querySelector('#shortcuts-button')) return;

  const button = document.createElement('button');
  button.className = 'nav-item';
  button.id = 'shortcuts-button';
  button.type = 'button';
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = '<span class="nav-icon">⌨</span><span>Shortcuts</span>';
  button.addEventListener('click', () => {
    store.setSettings({ [SETTING_KEY]: !isEnabled() });
    updateButton();
  });

  if (settingsButton?.parentElement === buttonHost) settingsButton.insertAdjacentElement('afterend', button);
  else buttonHost.appendChild(button);
  updateButton();
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;
  return Boolean(target.closest('dialog[open]'));
}

function selectedOrTopVisibleCard() {
  const cards = [...document.querySelectorAll('#comments-list .comment-card')]
    .filter((card) => !card.hidden && card.getClientRects().length > 0);
  if (!cards.length) return null;

  const selected = cards.find((card) => card.classList.contains('is-selected'));
  if (selected) return selected;

  const viewport = contentArea?.getBoundingClientRect();
  if (!viewport) return cards[0];

  const visible = cards
    .map((card) => ({ card, rect: card.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1)
    .sort((a, b) => a.rect.top - b.rect.top);

  return visible[0]?.card || cards[0];
}

function performAction(action) {
  const card = selectedOrTopVisibleCard();
  if (!card) return false;

  if (action === 'save') {
    const save = card.querySelector('[data-action="save"]');
    if (!save) return false;
    if (!/saved/i.test(save.textContent || '')) save.click();
    return true;
  }

  if (action === 'delete') {
    const remove = card.querySelector('[data-action="delete"]');
    if (!remove) return false;
    remove.click();
    return true;
  }

  return false;
}

document.addEventListener('keydown', (event) => {
  if (!isEnabled()) return;
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (isEditableTarget(event.target)) return;

  let handled = false;
  if (event.key === 'ArrowLeft') handled = performAction('delete');
  if (event.key === 'ArrowRight') handled = performAction('save');

  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

installButton();

console.info('[CC shortcuts] ready', { enabled: isEnabled(), legend: legend() });
