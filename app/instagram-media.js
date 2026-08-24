import { store } from './store.js';
import { helperRequest } from './helper-client.js';

const headerActions = document.querySelector('.header-actions');
const refreshButton = document.querySelector('#refresh-button');
const commentsList = document.querySelector('#comments-list');
const statusBanner = document.querySelector('#status-banner');

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

function ensureUi() {
  if (!headerActions || !refreshButton) return;
  if (!document.querySelector('#instagram-video-download')) {
    const video = document.createElement('button');
    video.id = 'instagram-video-download';
    video.type = 'button';
    video.className = 'ghost-action instagram-media-action';
    video.textContent = 'Video';
    video.hidden = true;
    refreshButton.insertAdjacentElement('beforebegin', video);
  }
  if (!document.querySelector('#instagram-photos-download')) {
    const photos = document.createElement('button');
    photos.id = 'instagram-photos-download';
    photos.type = 'button';
    photos.className = 'ghost-action instagram-media-action';
    photos.textContent = 'Photos';
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

function render() {
  ensureUi();
  const source = currentSource();
  const isInstagram = source?.platform === 'instagram';
  const availability = source?.instagramMediaAvailability || {};
  const videoButton = document.querySelector('#instagram-video-download');
  const photosButton = document.querySelector('#instagram-photos-download');
  const panel = document.querySelector('#instagram-downloaded-media');

  if (videoButton) videoButton.hidden = !isInstagram || availability.video === false;
  if (photosButton) photosButton.hidden = !isInstagram || availability.photos === false;

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

async function downloadKind(kind, button) {
  const source = currentSource();
  if (!source || source.platform !== 'instagram') return;

  const original = button.textContent;
  button.disabled = true;
  button.textContent = kind === 'video' ? 'Video…' : 'Photos…';
  try {
    const result = await helperRequest('instagram.downloadMedia', {
      url: source.url,
      sourceId: source.id,
      externalId: source.externalId,
      kind,
    }, 120000);

    const items = Array.isArray(result?.items) ? result.items : [];
    const availability = { ...(source.instagramMediaAvailability || {}) };
    availability[kind] = items.length > 0;

    if (!items.length) {
      store.updateSource(source.id, { instagramMediaAvailability: availability });
      showStatus(`No ${kind === 'video' ? 'video' : 'photos'} found in this Instagram post.`, 'error');
      render();
      return;
    }

    const previous = mediaItems(source);
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
    render();
  } catch (error) {
    showStatus(error?.message || 'Could not download Instagram media.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.addEventListener('click', (event) => {
  const video = event.target.closest?.('#instagram-video-download');
  if (video) {
    event.preventDefault();
    downloadKind('video', video);
    return;
  }

  const photos = event.target.closest?.('#instagram-photos-download');
  if (photos) {
    event.preventDefault();
    downloadKind('photos', photos);
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
  store.updateSource(sourceId, {
    instagramMediaAvailability: {
      ...(source.instagramMediaAvailability || {}),
      video: Boolean(availability.video),
      photos: Boolean(availability.photos),
    },
  });
  render();
});

window.addEventListener('popstate', () => requestAnimationFrame(render));

ensureUi();
render();
console.info('[CC Instagram media] local Downloads integration ready');
