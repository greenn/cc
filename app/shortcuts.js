import { store } from './store.js';

const buttonHost = document.querySelector('.left-bottom');
const settingsButton = document.querySelector('#settings-button');
const contentArea = document.querySelector('#content-area');
const SETTING_KEY = 'commentShortcutsEnabled';
let navigationHint = null;

function readEnabled() {
  try {
    return Boolean(store.getSettings()?.[SETTING_KEY]);
  } catch (error) {
    console.warn('[CC shortcuts] settings status unavailable', error);
    return null;
  }
}

function isEnabled() {
  return readEnabled() === true;
}

function legend(enabled = readEnabled()) {
  if (enabled === null) return 'Shortcuts status unavailable';
  return [
    `Shortcuts ${enabled ? 'ON' : 'OFF'}`,
    '← Delete comment',
    '→ Save comment',
    '↑ Previous comment',
    '↓ Next comment',
    'Target: selected comment; otherwise the top visible comment',
  ].join('\n');
}

function updateButton() {
  const button = document.querySelector('#shortcuts-button');
  if (!button) return;
  const enabled = readEnabled();
  const known = enabled !== null;
  button.disabled = !known;
  button.classList.toggle('is-active', enabled === true);
  button.setAttribute('aria-pressed', enabled === true ? 'true' : 'false');
  button.title = legend(enabled);
}

function installButton() {
  if (!buttonHost) return;

  let button = document.querySelector('#shortcuts-button');
  if (!button) {
    button = document.createElement('button');
    button.className = 'nav-item';
    button.id = 'shortcuts-button';
    button.type = 'button';
    button.disabled = true;
    button.setAttribute('aria-pressed', 'false');
    button.title = 'Shortcuts status unavailable';
    button.innerHTML = '<span class="nav-icon">⌨</span><span>Shortcuts</span>';
    if (settingsButton?.parentElement === buttonHost) settingsButton.insertAdjacentElement('afterend', button);
    else buttonHost.appendChild(button);
  }

  if (button.dataset.shortcutsBound !== '1') {
    button.dataset.shortcutsBound = '1';
    button.addEventListener('click', () => {
      const enabled = readEnabled();
      if (enabled === null) return;
      store.setSettings({ [SETTING_KEY]: !enabled });
      updateButton();
    });
  }

  updateButton();
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;
  return Boolean(target.closest('dialog[open]'));
}

function commentCards() {
  return [...document.querySelectorAll('#comments-list .comment-card')]
    .filter((card) => !card.hidden && card.getClientRects().length > 0);
}

function topVisibleCard(cards = commentCards()) {
  if (!cards.length) return null;
  const viewport = contentArea?.getBoundingClientRect();
  if (!viewport) return cards[0];

  const visible = cards
    .map((card) => ({ card, rect: card.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1)
    .sort((a, b) => a.rect.top - b.rect.top);

  return visible[0]?.card || cards[0];
}

function navigationContext() {
  const url = new URL(window.location.href);
  url.searchParams.delete('comment');
  return `${url.pathname}?${url.searchParams.toString()}`;
}

function rememberIndex(index) {
  if (!Number.isInteger(index) || index < 0) return;
  navigationHint = { index, context: navigationContext() };
}

function rememberedIndex() {
  if (!navigationHint || navigationHint.context !== navigationContext()) return null;
  return navigationHint.index;
}

function selectedOrTopVisibleCard() {
  const cards = commentCards();
  if (!cards.length) return null;
  return cards.find((card) => card.classList.contains('is-selected')) || topVisibleCard(cards);
}

function performAction(action) {
  const cards = commentCards();
  const card = cards.find((item) => item.classList.contains('is-selected')) || topVisibleCard(cards);
  if (!card) return false;

  const index = cards.indexOf(card);
  if (index >= 0) rememberIndex(index);

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

function navigateComments(direction) {
  const cards = commentCards();
  if (!cards.length) return false;

  const selectedIndex = cards.findIndex((card) => card.classList.contains('is-selected'));
  let targetIndex = null;

  if (selectedIndex >= 0) {
    targetIndex = selectedIndex + direction;
  } else {
    const hint = rememberedIndex();
    if (hint !== null) {
      // After deleting item N, the former N+1 moves into index N. Down should
      // therefore continue at N, while Up should go to N-1.
      targetIndex = direction > 0 ? hint : hint - 1;
    } else {
      const top = topVisibleCard(cards);
      targetIndex = top ? cards.indexOf(top) : 0;
    }
  }

  if (targetIndex < 0 || targetIndex >= cards.length) return true;
  const target = cards[targetIndex];
  if (!target) return false;

  rememberIndex(targetIndex);
  target.click();
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  return true;
}

// Capture the position before the app rerenders after a manual Delete click.
// This keeps Up/Down anchored at the deleted comment's position, not at the
// top of the list.
document.addEventListener('click', (event) => {
  const card = event.target.closest?.('#comments-list .comment-card');
  if (!card) return;
  const cards = commentCards();
  const index = cards.indexOf(card);
  if (index < 0) return;

  if (event.target.closest?.('[data-action="delete"]') || !event.target.closest?.('[data-action]')) {
    rememberIndex(index);
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (!isEnabled()) return;
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (isEditableTarget(event.target)) return;

  let handled = false;
  if (event.key === 'ArrowLeft') handled = performAction('delete');
  if (event.key === 'ArrowRight') handled = performAction('save');
  if (event.key === 'ArrowUp') handled = navigateComments(-1);
  if (event.key === 'ArrowDown') handled = navigateComments(1);

  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

installButton();

console.info('[CC shortcuts] ready', { enabled: readEnabled(), legend: legend() });
