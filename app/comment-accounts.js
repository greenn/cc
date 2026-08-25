import { store } from './store.js';

const headerActions = document.querySelector('.header-actions');
const refreshButton = document.querySelector('#refresh-button');
const commentsList = document.querySelector('#comments-list');
const sourcesList = document.querySelector('#sources-list');

function currentSource() {
  const activeId = document.querySelector('.source-item.is-active[data-source-id]')?.dataset.sourceId;
  if (activeId) return store.getSource(activeId);
  try {
    const sourceId = new URL(location.href).searchParams.get('source');
    return sourceId ? store.getSource(sourceId) : null;
  } catch {
    return null;
  }
}

function accountKey(comment) {
  const username = String(comment.authorUsername || '').trim().replace(/^@/, '').toLowerCase();
  if (username) return `u:${username}`;
  return `n:${String(comment.authorName || 'Unknown').trim().toLowerCase()}`;
}

function accountsForSource(sourceId) {
  const map = new Map();
  for (const comment of store.getComments(sourceId)) {
    const key = accountKey(comment);
    const existing = map.get(key) || {
      name: String(comment.authorName || comment.authorUsername || 'Unknown').trim() || 'Unknown',
      username: String(comment.authorUsername || '').trim(),
      count: 0,
    };
    existing.count += 1;
    if ((!existing.username || existing.username === '@') && comment.authorUsername) existing.username = String(comment.authorUsername).trim();
    if ((existing.name === 'Unknown' || !existing.name) && comment.authorName) existing.name = String(comment.authorName).trim();
    map.set(key, existing);
  }

  return [...map.values()].sort((a, b) => b.count - a.count
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function profileUrl(source, username) {
  const clean = String(username || '').trim().replace(/^@/, '');
  if (!clean) return '';
  if (source?.platform === 'instagram') return `https://www.instagram.com/${encodeURIComponent(clean)}/`;
  return '';
}

function ensureStyle() {
  if (document.querySelector('#cc-comment-accounts-styles')) return;
  const style = document.createElement('style');
  style.id = 'cc-comment-accounts-styles';
  style.textContent = `
    #comment-accounts-dialog {
      width: min(760px, calc(100vw - 40px));
      max-height: min(760px, calc(100vh - 56px));
      padding: 0;
      border: 1px solid #d8d8d8;
      background: #fff;
      color: #111;
      box-shadow: 0 20px 60px rgba(0,0,0,.18);
    }
    #comment-accounts-dialog::backdrop { background: rgba(0,0,0,.22); }
    .comment-accounts-card { display: grid; grid-template-rows: auto minmax(0,1fr); max-height: inherit; }
    .comment-accounts-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:20px 22px 14px; border-bottom:1px solid #e4e4e4; }
    .comment-accounts-head p { margin:0 0 4px; font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:#888; }
    .comment-accounts-head h2 { margin:0; font-size:22px; }
    .comment-accounts-close { appearance:none; border:0; background:transparent; font:24px/1 Arial,sans-serif; padding:3px 6px; cursor:pointer; }
    .comment-accounts-scroll { overflow:auto; min-height:120px; }
    .comment-accounts-table { width:100%; border-collapse:collapse; font-size:13px; }
    .comment-accounts-table th { position:sticky; top:0; z-index:1; text-align:left; padding:10px 22px; background:#fafafa; border-bottom:1px solid #ddd; font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:#777; }
    .comment-accounts-table td { padding:11px 22px; border-bottom:1px solid #eee; vertical-align:middle; }
    .comment-accounts-table th:last-child, .comment-accounts-table td:last-child { text-align:right; width:100px; font-variant-numeric:tabular-nums; }
    .comment-accounts-account { color:inherit; text-decoration:underline; text-underline-offset:2px; }
    .comment-accounts-empty { padding:30px 22px; color:#777; }
  `;
  document.head.appendChild(style);
}

function ensureUi() {
  ensureStyle();
  if (headerActions && refreshButton && !document.querySelector('#comment-accounts-button')) {
    const button = document.createElement('button');
    button.id = 'comment-accounts-button';
    button.type = 'button';
    button.className = 'ghost-action';
    button.textContent = 'Accounts · 0';
    button.hidden = true;
    button.title = 'Show accounts that commented on this source';
    refreshButton.insertAdjacentElement('beforebegin', button);
  }

  if (!document.querySelector('#comment-accounts-dialog')) {
    const dialog = document.createElement('dialog');
    dialog.id = 'comment-accounts-dialog';
    dialog.innerHTML = `
      <div class="comment-accounts-card">
        <div class="comment-accounts-head">
          <div><p>Comment authors</p><h2 id="comment-accounts-title">Accounts</h2></div>
          <button class="comment-accounts-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="comment-accounts-scroll" id="comment-accounts-content"></div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.comment-accounts-close')?.addEventListener('click', () => dialog.close());
  }
}

function renderDialog() {
  const source = currentSource();
  const content = document.querySelector('#comment-accounts-content');
  const title = document.querySelector('#comment-accounts-title');
  if (!content || !title || !source) return;

  const accounts = accountsForSource(source.id);
  title.textContent = `Accounts · ${accounts.length}`;
  if (!accounts.length) {
    content.innerHTML = '<div class="comment-accounts-empty">No commenter accounts have been collected yet.</div>';
    return;
  }

  const tbody = document.createElement('tbody');
  for (const account of accounts) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    const username = document.createElement('td');
    const count = document.createElement('td');
    name.textContent = account.name;
    const href = profileUrl(source, account.username);
    if (href) {
      const link = document.createElement('a');
      link.className = 'comment-accounts-account';
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = account.username || '—';
      username.appendChild(link);
    } else {
      username.textContent = account.username || '—';
    }
    count.textContent = String(account.count);
    row.append(name, username, count);
    tbody.appendChild(row);
  }

  const table = document.createElement('table');
  table.className = 'comment-accounts-table';
  table.innerHTML = '<thead><tr><th>Name</th><th>Account</th><th>Comments</th></tr></thead>';
  table.appendChild(tbody);
  content.replaceChildren(table);
}

function renderButton() {
  ensureUi();
  const button = document.querySelector('#comment-accounts-button');
  if (!button) return;
  const source = currentSource();
  button.hidden = !source;
  if (!source) return;
  const count = accountsForSource(source.id).length;
  button.textContent = `Accounts · ${count}`;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('#comment-accounts-button');
  if (button) {
    const dialog = document.querySelector('#comment-accounts-dialog');
    renderDialog();
    if (dialog && !dialog.open) dialog.showModal();
    return;
  }

  if (event.target.closest?.('.source-item, [data-open-source], #main-nav .nav-item, .brand')) {
    requestAnimationFrame(renderButton);
  }
});

window.addEventListener('popstate', () => requestAnimationFrame(renderButton));

if (commentsList) {
  new MutationObserver(() => {
    renderButton();
    if (document.querySelector('#comment-accounts-dialog')?.open) renderDialog();
  }).observe(commentsList, { childList: true });
}
if (sourcesList) {
  new MutationObserver(() => renderButton()).observe(sourcesList, { childList: true });
}

ensureUi();
renderButton();
console.info('[CC comment accounts] source author listing ready');
