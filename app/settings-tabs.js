import { store } from './store.js';

const form = document.querySelector('#settings-form');
const settingsButton = document.querySelector('#settings-button');

if (!form || window.__CC_SETTINGS_TABS_INSTALLED__) {
  // Nothing to initialize on pages without the settings dialog.
} else {
  window.__CC_SETTINGS_TABS_INSTALLED__ = true;

  const head = form.querySelector('.dialog-head');
  const actions = form.querySelector('.dialog-actions');
  const tabOrder = ['general', 'translation', 'instagram', 'vk', 'server'];
  const tabLabels = {
    general: 'General',
    translation: 'Translation',
    instagram: 'Instagram',
    vk: 'VK',
    server: 'Server',
  };
  const headingToTab = new Map([
    ['YouTube Data API', 'general'],
    ['Whisper on this computer', 'general'],
    ['CC Browser Helper', 'instagram'],
    ['VK video comments', 'vk'],
    ['PHP backend', 'server'],
  ]);

  const style = document.createElement('style');
  style.id = 'cc-settings-tabs-styles';
  style.textContent = `
    #settings-form { width:min(680px,calc(100vw - 36px)); }
    .settings-tabs { display:flex; gap:4px; flex-wrap:wrap; margin:-2px 0 10px; padding:4px; background:#f3f3f3; border:1px solid #e1e1e1; }
    .settings-tab { appearance:none; border:0; background:transparent; color:#666; padding:7px 10px; font:600 11px/1 system-ui,sans-serif; cursor:pointer; }
    .settings-tab.is-active { background:#fff; color:#111; box-shadow:0 1px 3px rgba(0,0,0,.08); }
    .settings-panel { display:grid; gap:8px; min-width:0; }
    .settings-panel[hidden] { display:none !important; }
    .settings-panel > div[style*="height:1px"] { margin:9px 0 3px !important; }
    .settings-choice { width:100%; min-height:36px; border:1px solid #d8d8d8; background:#fff; color:#111; padding:7px 9px; font:12px/1.2 system-ui,sans-serif; }
    .settings-readonly { border:1px solid #e2e2e2; background:#f7f7f7; padding:10px 11px; color:#555; font:11px/1.45 system-ui,sans-serif; }
    .settings-field-title { display:block; margin-top:3px; font:600 12px/1.25 system-ui,sans-serif; color:#222; }
  `;
  document.head.appendChild(style);

  const tabs = document.createElement('div');
  tabs.className = 'settings-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Settings sections');

  const panels = new Map();
  for (const key of tabOrder) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-tab';
    button.dataset.settingsTab = key;
    button.textContent = tabLabels[key];
    button.setAttribute('role', 'tab');
    tabs.appendChild(button);

    const panel = document.createElement('section');
    panel.className = 'settings-panel';
    panel.dataset.settingsPanel = key;
    panel.setAttribute('role', 'tabpanel');
    panels.set(key, panel);
  }

  const movable = [...form.children].filter((node) => node !== head && node !== actions);
  let currentKey = 'general';
  for (const node of movable) {
    const strong = node.querySelector?.(':scope > strong');
    const heading = strong?.textContent?.trim() || '';
    if (headingToTab.has(heading)) currentKey = headingToTab.get(heading);
    panels.get(currentKey)?.appendChild(node);
  }

  const translationPanel = panels.get('translation');
  translationPanel.innerHTML = `
    <div><p class="eyebrow" style="margin-bottom:2px">Comments</p><strong style="font-size:13px">Default translation</strong></div>
    <label class="settings-field-title" for="translation-target-language">Default translation language</label>
    <select id="translation-target-language" class="settings-choice">
      <option value="ru">Russian</option>
    </select>
    <p class="form-hint">The per-comment Translate action uses this target. Russian is the currently supported default target.</p>
    <label class="settings-field-title">Translation mechanism</label>
    <div class="settings-readonly"><strong>Chrome built-in LanguageDetector + Translator APIs</strong><br>Language detection and translation run through Chrome's built-in on-device APIs. Chrome may download a language pack the first time a language pair is used. CC does not send comment text to a separate translation API.</div>
  `;

  const instagramPanel = panels.get('instagram');
  const methodBox = document.createElement('div');
  methodBox.innerHTML = `
    <div style="height:1px;background:#e7e7e7;margin:8px 0 2px"></div>
    <div><p class="eyebrow" style="margin-bottom:2px">Comment collection</p><strong style="font-size:13px">Instagram comment method</strong></div>
    <label class="settings-field-title" for="instagram-comment-method">Collection method</label>
    <select id="instagram-comment-method" class="settings-choice">
      <option value="dom">DOM collector — current method</option>
      <option value="network">Network / GraphQL cursor — experimental</option>
    </select>
    <p class="form-hint">DOM collector opens the rendered Comments panel and scrolls/clicks through it. Network / GraphQL listens to the requests made by the signed-in Instagram page, captures a comment pagination request, then follows its cursor without rendering thousands of comment DOM nodes. The network method is experimental because Instagram can change its private web request format.</p>
  `;
  while (methodBox.firstChild) instagramPanel.appendChild(methodBox.firstChild);

  if (head) head.insertAdjacentElement('afterend', tabs);
  for (const key of tabOrder) form.insertBefore(panels.get(key), actions || null);

  function activate(key) {
    const wanted = panels.has(key) ? key : 'general';
    tabs.querySelectorAll('[data-settings-tab]').forEach((button) => {
      const active = button.dataset.settingsTab === wanted;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    for (const [panelKey, panel] of panels) panel.hidden = panelKey !== wanted;
    try { sessionStorage.setItem('cc-settings-active-tab', wanted); } catch { /* no-op */ }
  }

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-settings-tab]');
    if (!button) return;
    event.preventDefault();
    activate(button.dataset.settingsTab);
  });

  function loadValues() {
    const settings = store.getSettings();
    const translation = document.querySelector('#translation-target-language');
    const instagramMethod = document.querySelector('#instagram-comment-method');
    if (translation) translation.value = settings.translationTargetLanguage || 'ru';
    if (instagramMethod) instagramMethod.value = settings.instagramCommentMethod || 'dom';
  }

  settingsButton?.addEventListener('click', () => {
    loadValues();
    let remembered = 'general';
    try { remembered = sessionStorage.getItem('cc-settings-active-tab') || 'general'; } catch { /* no-op */ }
    activate(remembered);
  });

  // Capture phase saves these settings before app.js closes the dialog.
  form.addEventListener('submit', (event) => {
    if (event.submitter?.value === 'cancel') return;
    const translation = document.querySelector('#translation-target-language');
    const instagramMethod = document.querySelector('#instagram-comment-method');
    store.setSettings({
      translationTargetLanguage: translation?.value || 'ru',
      instagramCommentMethod: instagramMethod?.value === 'network' ? 'network' : 'dom',
    });
  }, true);

  loadValues();
  activate('general');
  console.info('[CC settings] tabbed settings, translation target, and Instagram collection method ready');
}
