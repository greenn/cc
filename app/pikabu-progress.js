import { store } from './store.js';

const bySource = new Map();
const badge = document.createElement('span');
badge.id = 'cc-pikabu-progress';
badge.hidden = true;
badge.style.cssText = 'display:inline-flex;align-items:center;padding:5px 8px;font:11px system-ui;border:1px solid #dedede;background:#fff;color:#444;';
const header = document.querySelector('.header-actions');
const refresh = document.querySelector('#refresh-button');
if (refresh?.parentElement === header) refresh.before(badge);
else header?.prepend(badge);

function activeSourceId() {
  return document.querySelector('.source-item.is-active[data-source-id]')?.dataset.sourceId
    || new URL(location.href).searchParams.get('source') || '';
}

function render() {
  const id = activeSourceId();
  const info = bySource.get(id);
  const visible = id.startsWith('pikabu:') && info && info.active;
  badge.hidden = !visible;
  if (!visible) return;
  badge.textContent = 'Pikabu · найдено ' + (info.found || 0)
    + ' · сохранено ' + (info.saved || 0)
    + ' · ' + (info.phase || 'загрузка');
  badge.title = 'Прогресс загрузки комментариев Pikabu. Страница открыта во временной вкладке браузера.';
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'cc-helper') return;
  const message = event.data;
  if (message.type !== 'CC_HELPER_PROGRESS') return;
  const id = String(message.sourceId || '');
  if (!id.startsWith('pikabu:')) return;
  const progress = message.progress || {};
  const previous = bySource.get(id) || {};
  const newPass = previous.passId !== progress.passId;
  const phase = String(progress.phase || 'collecting');
  bySource.set(id, {
    passId: progress.passId || '',
    found: Math.max(0, Number(progress.collected || 0)),
    saved: newPass ? 0 : (previous.saved || 0),
    phase,
    active: !['complete', 'partial', 'interrupted'].includes(phase),
  });
  render();
});

window.addEventListener('cc:pikabu-stream-saved', (event) => {
  const { sourceId, passId, received } = event.detail || {};
  const id = String(sourceId || '');
  if (!id.startsWith('pikabu:')) return;
  const previous = bySource.get(id) || {};
  bySource.set(id, {
    ...previous,
    passId: passId || previous.passId,
    saved: Math.max(0, Number(received || 0)),
    active: true,
  });
  render();
});
document.addEventListener('click', () => requestAnimationFrame(render));
window.addEventListener('popstate', render);
