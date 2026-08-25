import { store } from './store.js';

const sourcesList = document.querySelector('#sources-list');
const sectionLabel = document.querySelector('.sources-section > .section-label');
const STORAGE_KEY = 'cc-collapsed-source-groups-v1';
const COLLAPSIBLE_PLATFORMS = new Set(['youtube', 'instagram']);

function readCollapsedState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

const collapsedState = readCollapsedState();

function persistCollapsedState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsedState));
}

function installStyles() {
  if (document.querySelector('#cc-source-group-collapse-styles')) return;
  const style = document.createElement('style');
  style.id = 'cc-source-group-collapse-styles';
  style.textContent = `
    .source-group-title.is-collapsible {
      min-height: 28px;
      margin: 2px 0 4px;
      padding: 0 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }

    .source-group-title.is-collapsible:hover {
      color: #4f4a39;
      background: rgba(255, 255, 255, .32);
    }

    .source-group-toggle {
      flex: 0 0 auto;
      font-size: 11px;
      line-height: 1;
      transition: transform .15s ease;
    }

    .source-group.is-collapsed .source-group-toggle {
      transform: rotate(-90deg);
    }

    .source-group.is-collapsed .source-item {
      display: none;
    }

    .source-group.is-collapsed {
      margin-bottom: 5px;
    }
  `;
  document.head.appendChild(style);
}

function platformForGroup(group) {
  const firstSourceId = group.querySelector('.source-item')?.dataset.sourceId;
  const platform = firstSourceId ? store.getSource(firstSourceId)?.platform : null;
  if (platform) return String(platform).toLowerCase();

  const title = group.querySelector('.source-group-title')?.textContent?.trim().toLowerCase() || '';
  if (title.includes('youtube')) return 'youtube';
  if (title.includes('instagram')) return 'instagram';
  return '';
}

function applyGroupState(group, platform) {
  const collapsed = Boolean(collapsedState[platform]);
  const title = group.querySelector('.source-group-title');
  const toggle = title?.querySelector('.source-group-toggle');

  group.classList.toggle('is-collapsed', collapsed);
  title?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (toggle) toggle.setAttribute('aria-hidden', 'true');
}

function bindGroup(group) {
  const platform = platformForGroup(group);
  if (!COLLAPSIBLE_PLATFORMS.has(platform)) return;

  const title = group.querySelector('.source-group-title');
  if (!title) return;

  group.dataset.platform = platform;
  title.classList.add('is-collapsible');
  title.setAttribute('role', 'button');
  title.setAttribute('tabindex', '0');
  title.title = `Collapse or expand ${platform}`;

  if (!title.querySelector('.source-group-toggle')) {
    const toggle = document.createElement('span');
    toggle.className = 'source-group-toggle';
    toggle.textContent = '▾';
    title.appendChild(toggle);
  }

  if (title.dataset.collapseBound !== '1') {
    title.dataset.collapseBound = '1';

    const toggleGroup = () => {
      collapsedState[platform] = !Boolean(collapsedState[platform]);
      persistCollapsedState();
      applyGroupState(group, platform);
    };

    title.addEventListener('click', toggleGroup);
    title.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleGroup();
    });
  }

  applyGroupState(group, platform);
}

function enhanceGroups() {
  sourcesList?.querySelectorAll(':scope > .source-group').forEach(bindGroup);
}

installStyles();
sectionLabel?.remove();
enhanceGroups();

if (sourcesList) {
  new MutationObserver(enhanceGroups).observe(sourcesList, { childList: true });
}

console.info('[CC source groups] left Sources label removed; YouTube/Instagram groups are collapsible');
