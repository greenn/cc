const headerActions = document.querySelector('.header-actions');
const operations = window.__CC_SOURCE_OPERATIONS__ ||= new Map();
const progressBySource = window.__CC_INSTAGRAM_PROGRESS__ ||= new Map();
const watchers = new Map();

function currentSourceId() {
  const activeId = document.querySelector('.source-item.is-active[data-source-id]')?.dataset.sourceId;
  if (activeId) return activeId;
  try {
    return new URL(location.href).searchParams.get('source') || '';
  } catch {
    return '';
  }
}

function activeOperation(sourceId) {
  const set = operations.get(sourceId);
  if (!(set instanceof Set)) return '';
  if (set.has('more')) return 'more';
  if (set.has('refresh')) return 'refresh';
  return '';
}

function phaseLabel(phase) {
  const labels = {
    opening: 'opening Instagram',
    retrying: 'retrying',
    'opening-comments': 'opening comments',
    'waiting-comments': 'waiting for comments',
    collecting: 'collecting',
    checking: 'checking',
    expanding: 'opening more',
    scrolling: 'scrolling',
    'waiting-more': 'waiting for more',
    'waiting-panel': 'waiting for panel',
    complete: 'finishing',
  };
  return labels[phase] || String(phase || 'working');
}

function ensureStyle() {
  if (document.querySelector('#cc-instagram-progress-styles')) return;
  const style = document.createElement('style');
  style.id = 'cc-instagram-progress-styles';
  style.textContent = `
    .instagram-helper-progress {
      display:inline-flex;
      align-items:center;
      min-height:30px;
      padding:0 8px;
      border:1px solid #dedede;
      background:#fff;
      color:#555;
      font-size:11px;
      line-height:1;
      white-space:nowrap;
    }
    .instagram-helper-progress strong {
      color:#111;
      font-weight:700;
      font-variant-numeric:tabular-nums;
    }
  `;
  document.head.appendChild(style);
}

function ensureChip() {
  ensureStyle();
  let chip = document.querySelector('#instagram-helper-progress');
  if (!chip && headerActions) {
    chip = document.createElement('span');
    chip.id = 'instagram-helper-progress';
    chip.className = 'instagram-helper-progress';
    chip.hidden = true;
    const refresh = document.querySelector('#refresh-button');
    if (refresh?.parentElement === headerActions) refresh.insertAdjacentElement('beforebegin', chip);
    else headerActions.prepend(chip);
  }
  return chip;
}

function progressText(progress) {
  const collected = Math.max(0, Number(progress?.collected || 0));
  const step = Math.max(0, Number(progress?.step || 0));
  const maxSteps = Math.max(0, Number(progress?.maxSteps || 0));
  const phase = phaseLabel(progress?.phase);
  return maxSteps > 0
    ? `Helper · ${collected} comments · ${phase} ${step}/${maxSteps}`
    : `Helper · ${collected} comments · ${phase}`;
}

function progressTitle(progress) {
  const collected = Math.max(0, Number(progress?.collected || 0));
  const clicks = Math.max(0, Number(progress?.clicks || 0));
  const scrollMoves = Math.max(0, Number(progress?.scrollMoves || 0));
  const stableRounds = Math.max(0, Number(progress?.stableRounds || 0));
  const stableLimit = Math.max(0, Number(progress?.stableLimit || 0));
  return [
    `${collected} comments collected in this helper pass`,
    `phase: ${phaseLabel(progress?.phase)}`,
    `load/expand clicks: ${clicks}`,
    `scroll moves: ${scrollMoves}`,
    stableLimit ? `stable checks: ${stableRounds}/${stableLimit}` : '',
  ].filter(Boolean).join('\n');
}

function renderSourceBadge(sourceId, progress, operation) {
  const item = document.querySelector(`#sources-list .source-item[data-source-id="${CSS.escape(sourceId)}"]`);
  if (!item) return;
  const small = item.querySelector('.source-copy small');
  let badge = item.querySelector('.source-operation-badge');

  if (!operation || !progress) return;
  if (!badge && small) {
    badge = document.createElement('span');
    badge.className = 'source-operation-badge';
    small.appendChild(badge);
  }
  if (!badge) return;

  const label = operation === 'more' ? 'Load more' : 'Refresh';
  badge.textContent = `${label} · ${Math.max(0, Number(progress.collected || 0))}`;
  badge.title = progressTitle(progress);
}

function render() {
  const chip = ensureChip();
  const currentId = currentSourceId();
  const currentProgress = progressBySource.get(currentId) || null;
  const operation = currentId ? activeOperation(currentId) : '';

  if (chip) {
    chip.hidden = !(currentProgress && operation);
    if (currentProgress && operation) {
      chip.innerHTML = `Helper · <strong>${Math.max(0, Number(currentProgress.collected || 0))}</strong> comments · ${phaseLabel(currentProgress.phase)}${Number(currentProgress.maxSteps || 0) > 0 ? ` ${Math.max(0, Number(currentProgress.step || 0))}/${Math.max(0, Number(currentProgress.maxSteps || 0))}` : ''}`;
      chip.title = progressTitle(currentProgress);
    }
  }

  const refresh = document.querySelector('#refresh-button');
  const more = document.querySelector('#instagram-load-more');
  if (refresh) refresh.textContent = currentProgress && operation === 'refresh'
    ? `Refresh · ${Math.max(0, Number(currentProgress.collected || 0))}`
    : 'Refresh';
  if (more) more.textContent = currentProgress && operation === 'more'
    ? `Load more · ${Math.max(0, Number(currentProgress.collected || 0))}`
    : 'Load more';

  for (const [sourceId, progress] of progressBySource) {
    renderSourceBadge(sourceId, progress, activeOperation(sourceId));
  }
}

function watchUntilOperationEnds(sourceId) {
  if (!sourceId || watchers.has(sourceId)) return;
  const timer = window.setInterval(() => {
    if (activeOperation(sourceId)) {
      render();
      return;
    }
    clearInterval(timer);
    watchers.delete(sourceId);
    progressBySource.delete(sourceId);
    render();
  }, 300);
  watchers.set(sourceId, timer);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== 'cc-helper' || message.type !== 'CC_HELPER_PROGRESS') return;
  const sourceId = String(message.sourceId || '');
  if (!sourceId) return;
  progressBySource.set(sourceId, { ...(message.progress || {}) });
  watchUntilOperationEnds(sourceId);
  render();
});

document.addEventListener('click', (event) => {
  if (event.target.closest?.('.source-item, [data-open-source], #main-nav .nav-item, .brand')) {
    requestAnimationFrame(render);
  }
});
window.addEventListener('popstate', () => requestAnimationFrame(render));

ensureChip();
render();
console.info('[CC Instagram progress] live helper collection counters ready');
