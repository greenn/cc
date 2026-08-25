import { store } from './store.js';
import { helperRequest } from './helper-client.js';
import { instagramAdapter } from './platforms/instagram.js';

const headerActions = document.querySelector('.header-actions');
const refreshButton = document.querySelector('#refresh-button');
const commentsList = document.querySelector('#comments-list');
const sourcesList = document.querySelector('#sources-list');
const statusBanner = document.querySelector('#status-banner');
const operations = window.__CC_SOURCE_OPERATIONS__ ||= new Map();

function currentSource() {
  const activeId = document.querySelector('.source-item.is-active')?.dataset.sourceId;
  if (activeId) return store.getSource(activeId);
  try {
    const id = new URL(location.href).searchParams.get('source');
    return id ? store.getSource(id) : null;
  } catch {
    return null;
  }
}

function showStatus(message, kind = 'info') {
  if (!statusBanner) return;
  statusBanner.textContent = message;
  statusBanner.dataset.kind = kind;
  statusBanner.hidden = false;
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => { statusBanner.hidden = true; }, kind === 'error' ? 12000 : 5000);
}

function operationSet(sourceId, create = false) {
  let set = operations.get(sourceId);
  if (!(set instanceof Set) && create) {
    set = new Set();
    operations.set(sourceId, set);
  }
  return set instanceof Set ? set : null;
}

function isOperationRunning(sourceId, operation) {
  return Boolean(operationSet(sourceId)?.has(operation));
}

function operationLabel(operation) {
  if (operation === 'refresh') return 'Refresh';
  if (operation === 'video') return 'Video';
  if (operation === 'photos') return 'Photos';
  return operation;
}

function setOperation(sourceId, operation, active) {
  const set = operationSet(sourceId, true);
  if (active) set.add(operation);
  else set.delete(operation);
  if (!set.size) operations.delete(sourceId);
  render();
}

function ensureUi() {
  if (!headerActions || !refreshButton) return;
  if (!document.querySelector('#instagram-video-download')) {
    const video = document.createElement('button');
    video.id = 'instagram-video-download';
    video.type = 'button';
    video.className = 'ghost-action instagram-media-action';
    video.textContent = 'Video · ?';
    video.hidden = true;
    refreshButton.insertAdjacentElement('beforebegin', video);
  }
  if (!document.querySelector('#instagram-photos-download')) {
    const photos = document.createElement('button');
    photos.id = 'instagram-photos-download';
    photos.type = 'button';
    photos.className = 'ghost-action instagram-media-action';
    photos.textContent = 'Photos · ?';
    photos.hidden = true;
    refreshButton.insertAdjacentElement('beforebegin', photos);
  }
  if (commentsList && !document.querySelector('#instagram-downloaded-media')) {
    const panel = document.createElement('div');
    panel.id = 'instagram-downloaded-media';
    panel.className = 'instagram-downloaded-media';
    panel.hidden = true;
    commentsList.insertAdjacentElement('beforebegin', panel);
  }
}

function mediaItems(source) {
  return Array.isArray(source?.downloadedMedia) ? source.downloadedMedia : [];
}

function detectedCount(availability, kind) {
  const key = kind === 'video' ? 'videoCount' : 'photoCount';
  const value = Number(availability?.[key]);
  if (Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (availability?.[kind] === false) return 0;
  return null;
}

function renderMediaButton(button, source, kind, label, count) {
  if (!button) return;
  const isInstagram = source?.platform === 'instagram';
  button.hidden = !isInstagram;
  button.classList.remove('cc-operation-running');
  if (!isInstagram) return;

  const running = isOperationRunning(source.id, kind);
  button.textContent = `${label} · ${count == null ? '?' : count}`;
  button.disabled = running || count === 0;
  button.classList.toggle('cc-operation-running', running);
  button.title = running
    ? `${label} is being processed for this Instagram source.`
    : count === 0
      ? `No ${label.toLowerCase()} detected in the last Instagram check.`
      : count == null
        ? `${label} count is not known yet. Refresh the source or press this button to check.`
        : `${count} ${label.toLowerCase()} item${count === 1 ? '' : 's'} detected. Click to download.`;
}

function renderSourceOperations() {
  document.querySelectorAll('#sources-list .source-item[data-source-id]').forEach((item) => {
    const sourceId = item.dataset.sourceId;
    const active = operationSet(sourceId);
    item.classList.toggle('is-operation-running', Boolean(active?.size));

    const small = item.querySelector('.source-copy small');
    let badge = item.querySelector('.source-operation-badge');
    if (!active?.size) {
      badge?.remove();
      return;
    }

    if (!badge && small) {
      badge = document.createElement('span');
      badge.className = 'source-operation-badge';
      small.appendChild(badge);
    }
    if (!badge) return;

    const labels = [...active].map(operationLabel);
    badge.textContent = labels.length === 1 ? labels[0] : `${labels.length} tasks`;
    badge.title = `${labels.join(' + ')} in progress`;
  });
}

function render() {
  ensureUi();
  const source = currentSource();
  const isInstagram = source?.platform === 'instagram';
  const availability = source?.instagramMediaAvailability || {};
  const videoButton = document.querySelector('#instagram-video-download');
  const photosButton = document.querySelector('#instagram-photos-download');
  const panel = document.querySelector('#instagram-downloaded-media');

  renderMediaButton(videoButton, source, 'video', 'Video', detectedCount(availability, 'video'));
  renderMediaButton(photosButton, source, 'photos', 'Photos', detectedCount(availability, 'photos'));

  if (refreshButton) {
    const refreshRunning = Boolean(isInstagram && isOperationRunning(source.id, 'refresh'));
    refreshButton.classList.toggle('cc-operation-running', refreshRunning);
    if (isInstagram) {
      refreshButton.disabled = refreshRunning;
      refreshButton.title = refreshRunning ? 'Refreshing this Instagram source…' : 'Refresh Instagram comments and media information';
    } else {
      refreshButton.classList.remove('cc-operation-running');
      refreshButton.disabled = false;
      refreshButton.removeAttribute('title');
    }
  }

  renderSourceOperations();

  if (!panel) return;
  if (!isInstagram) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }

  const items = mediaItems(source);
  if (!items.length) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }

  panel.hidden = false;
  panel.innerHTML = `<span class="instagram-downloaded-label">Downloaded</span>${items.map((item, index) => {
    const icon = item.kind === 'video' ? '▶' : '▧';
    const label = item.kind === 'video' ? 'Video' : 'Photo';
    return `<button type="button" class="instagram-downloaded-item" data-download-id="${Number(item.downloadId) || 0}" title="${String(item.filename || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${icon} ${label}${items.length > 1 ? ` ${index + 1}` : ''} ✓</button>`;
  }).join('')}`;
}

function refreshCurrentSourceUi(sourceId) {
  const active = document.querySelector(`.source-item.is-active[data-source-id="${CSS.escape(sourceId)}"]`);
  if (!active) return;
  const tab = document.querySelector('#top-tabs .top-tab.is-active:not(:disabled)')
    || document.querySelector('#top-tabs .top-tab:not(:disabled)');
  if (tab) tab.click();
}

async function refreshInstagram(source) {
  if (!source || source.platform !== 'instagram' || isOperationRunning(source.id, 'refresh')) return;
  setOperation(source.id, 'refresh', true);
  showStatus('Refreshing Instagram comments and checking media…');

  try {
    const page = await instagramAdapter.getComments(source, null);
    store.upsertComments(source.id, page.comments || []);
    const patch = {
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      loadedCount: store.getComments(source.id).length,
      lastUpdatedAt: new Date().toISOString(),
      integrationStatus: 'ready',
    };
    if (page.totalResults != null) patch.commentCount = page.totalResults;
    store.updateSource(source.id, patch);
    showStatus('Instagram source refreshed. Comments and media information were updated.');
  } catch (error) {
    showStatus(error?.message || 'Could not refresh Instagram source.', 'error');
  } finally {
    setOperation(source.id, 'refresh', false);
    refreshCurrentSourceUi(source.id);
    render();
  }
}

async function downloadKind(kind, button) {
  const source = currentSource();
  if (!source || source.platform !== 'instagram' || isOperationRunning(source.id, kind)) return;

  setOperation(source.id, kind, true);
  try {
    const result = await helperRequest('instagram.downloadMedia', {
      url: source.url,
      sourceId: source.id,
      externalId: source.externalId,
      kind,
    }, 180000);

    const items = Array.isArray(result?.items) ? result.items : [];
    const counts = result?.counts || {};
    const availability = { ...(store.getSource(source.id)?.instagramMediaAvailability || {}) };
    const rawCount = Number(kind === 'video' ? counts.video : counts.photos);
    const count = Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : items.length;
    availability[kind] = count > 0;
    if (kind === 'video') availability.videoCount = count;
    else availability.photoCount = count;

    if (!items.length) {
      store.updateSource(source.id, { instagramMediaAvailability: availability });
      showStatus(`No ${kind === 'video' ? 'video' : 'photos'} found in this Instagram post.`, 'error');
      return;
    }

    const latestSource = store.getSource(source.id) || source;
    const previous = mediaItems(latestSource);
    const merged = [...previous];
    for (const item of items) {
      if (!merged.some((saved) => saved.downloadId === item.downloadId || (saved.filename && saved.filename === item.filename))) {
        merged.push(item);
      }
    }

    store.updateSource(source.id, {
      downloadedMedia: merged,
      instagramMediaAvailability: availability,
      mediaDownloadedAt: new Date().toISOString(),
    });
    showStatus(`${items.length} Instagram ${kind === 'video' ? 'video' : 'photo'} file${items.length === 1 ? '' : 's'} saved to Downloads/CC/Instagram.`);
  } catch (error) {
    showStatus(error?.message || 'Could not download Instagram media.', 'error');
  } finally {
    setOperation(source.id, kind, false);
    refreshCurrentSourceUi(source.id);
    render();
  }
}

// Instagram Refresh is handled here rather than by app.js so operations are
// tracked per source. That allows two different Instagram sources to refresh
// concurrently, each in its own Browser Helper worker tab.
document.addEventListener('click', (event) => {
  const refresh = event.target.closest?.('#refresh-button');
  if (!refresh) return;
  const source = currentSource();
  if (source?.platform !== 'instagram') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void refreshInstagram(source);
}, true);

document.addEventListener('click', (event) => {
  const video = event.target.closest?.('#instagram-video-download');
  if (video) {
    event.preventDefault();
    void downloadKind('video', video);
    return;
  }

  const photos = event.target.closest?.('#instagram-photos-download');
  if (photos) {
    event.preventDefault();
    void downloadKind('photos', photos);
    return;
  }

  const downloaded = event.target.closest?.('.instagram-downloaded-item[data-download-id]');
  if (downloaded) {
    const downloadId = Number(downloaded.dataset.downloadId || 0);
    if (downloadId > 0) {
      helperRequest('download.open', { downloadId }, 5000).catch((error) => showStatus(error?.message || 'Could not open downloaded file.', 'error'));
    }
    return;
  }

  if (event.target.closest?.('.source-item, [data-open-source], #main-nav .nav-item, .brand')) {
    requestAnimationFrame(render);
  }
});

window.addEventListener('cc:instagram-media-availability', (event) => {
  const sourceId = event.detail?.sourceId;
  const availability = event.detail?.availability;
  if (!sourceId || !availability) return;
  const source = store.getSource(sourceId);
  if (!source) return;

  const videoCountRaw = Number(availability.videoCount);
  const photoCountRaw = Number(availability.photoCount);
  const videoCount = Number.isFinite(videoCountRaw)
    ? Math.max(0, Math.floor(videoCountRaw))
    : availability.video === false ? 0 : null;
  const photoCount = Number.isFinite(photoCountRaw)
    ? Math.max(0, Math.floor(photoCountRaw))
    : availability.photos === false ? 0 : null;

  store.updateSource(sourceId, {
    instagramMediaAvailability: {
      ...(source.instagramMediaAvailability || {}),
      video: Boolean(availability.video),
      photos: Boolean(availability.photos),
      ...(videoCount == null ? {} : { videoCount }),
      ...(photoCount == null ? {} : { photoCount }),
      checkedAt: new Date().toISOString(),
    },
  });
  render();
});

window.addEventListener('popstate', () => requestAnimationFrame(render));

if (sourcesList) {
  new MutationObserver(() => renderSourceOperations()).observe(sourcesList, { childList: true });
}

ensureUi();
render();
console.info('[CC Instagram media] concurrent operations, counts, and local Downloads integration ready');
