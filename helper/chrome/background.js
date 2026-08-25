const CC_PAGE_PATTERNS = [
  'https://greenn.github.io/cc/*',
  'https://*.nadube.ru/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
];

function setGlobalBadge() {
  chrome.action.setBadgeText({ text: 'ON' });
  chrome.action.setBadgeBackgroundColor({ color: '#198754' });
  chrome.action.setTitle({ title: 'CC Browser Helper — running' });
}

function setConnectedBadge(tabId) {
  if (!tabId) return;
  chrome.action.setBadgeText({ tabId, text: 'CC' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#198754' });
  chrome.action.setTitle({ tabId, title: 'CC Browser Helper — connected to CC' });
}

async function injectBridgeIntoOpenCcTabs() {
  const tabs = await chrome.tabs.query({ url: CC_PAGE_PATTERNS });
  await Promise.all(tabs.filter((tab) => tab.id).map(async (tab) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['cc-bridge.js'],
      });
      setConnectedBadge(tab.id);
    } catch {
      // Some special/restoring tabs cannot be injected yet; normal content-script loading will handle them later.
    }
  }));
}

setGlobalBadge();

chrome.runtime.onInstalled.addListener(() => {
  setGlobalBadge();
  injectBridgeIntoOpenCcTabs();
});

chrome.runtime.onStartup.addListener(() => {
  setGlobalBadge();
});

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Instagram page did not finish loading in time.'));
    }, timeoutMs);

    const listener = (updatedId, changeInfo) => {
      if (updatedId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response?.ok) reject(new Error(response?.error || 'Instagram helper failed.'));
      else resolve(response.result);
    });
  });
}

async function restoreCallerFocus(caller) {
  if (!caller?.tabId) return;
  try {
    await chrome.tabs.update(caller.tabId, { active: true });
  } catch {
    return;
  }
  if (caller.windowId) {
    try {
      await chrome.windows.update(caller.windowId, { focused: true });
    } catch {
      // The CC window may have been closed while collection was running.
    }
  }
}

async function createInstagramWorkerTab(targetUrl, caller) {
  const createProperties = {
    url: targetUrl,
    active: false,
  };

  if (caller?.windowId) createProperties.windowId = caller.windowId;
  if (Number.isInteger(caller?.index)) createProperties.index = caller.index + 1;
  if (caller?.tabId) createProperties.openerTabId = caller.tabId;

  const tab = await chrome.tabs.create(createProperties);
  if (!tab.id) throw new Error('Could not open Instagram background tab.');

  await restoreCallerFocus(caller);
  await waitForTabComplete(tab.id);
  await restoreCallerFocus(caller);

  return tab.id;
}

async function getMediaAvailability(tabId) {
  try {
    const [video, photos] = await Promise.all([
      sendTabMessage(tabId, { type: 'CC_INSTAGRAM_MEDIA', kind: 'video' }),
      sendTabMessage(tabId, { type: 'CC_INSTAGRAM_MEDIA', kind: 'photos' }),
    ]);
    const videoCountRaw = Number(video?.counts?.video ?? video?.urls?.length ?? 0);
    const photoCountRaw = Number(photos?.counts?.photos ?? photos?.urls?.length ?? 0);
    const videoCount = Number.isFinite(videoCountRaw) ? Math.max(0, Math.floor(videoCountRaw)) : 0;
    const photoCount = Number.isFinite(photoCountRaw) ? Math.max(0, Math.floor(photoCountRaw)) : 0;
    return {
      video: videoCount > 0,
      photos: photoCount > 0,
      videoCount,
      photoCount,
    };
  } catch {
    return null;
  }
}

async function decorateCollectResult(tabId, result) {
  const mediaAvailability = await getMediaAvailability(tabId);
  return mediaAvailability ? { ...result, mediaAvailability } : result;
}

async function collectInstagram(payload, caller) {
  if (!payload?.url) throw new Error('Instagram URL is missing.');

  const tabId = await createInstagramWorkerTab(payload.url, caller);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await restoreCallerFocus(caller);

  try {
    try {
      const result = await sendTabMessage(tabId, {
        type: 'CC_INSTAGRAM_COLLECT',
        url: payload.url,
        sourceId: payload.sourceId,
        maxClicks: payload.maxClicks || 40,
      });
      await restoreCallerFocus(caller);
      return await decorateCollectResult(tabId, result);
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await restoreCallerFocus(caller);
      const result = await sendTabMessage(tabId, {
        type: 'CC_INSTAGRAM_COLLECT',
        url: payload.url,
        sourceId: payload.sourceId,
        maxClicks: payload.maxClicks || 40,
      });
      await restoreCallerFocus(caller);
      return await decorateCollectResult(tabId, result);
    }
  } finally {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // The user may have closed the temporary tab first.
    }
    await restoreCallerFocus(caller);
  }
}

function safePathPart(value, fallback = 'post') {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function extensionFor(url, kind) {
  try {
    const ext = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'].includes(ext)) return ext;
  } catch { /* fallback below */ }
  return kind === 'video' ? 'mp4' : 'jpg';
}

function downloadUrl(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    }, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!downloadId) reject(new Error('Chrome did not start the media download.'));
      else resolve(downloadId);
    });
  });
}

async function downloadInstagramMedia(payload, caller) {
  if (!payload?.url) throw new Error('Instagram URL is missing.');
  const kind = payload.kind === 'video' ? 'video' : 'photos';
  const tabId = await createInstagramWorkerTab(payload.url, caller);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await restoreCallerFocus(caller);

  try {
    let detected;
    try {
      detected = await sendTabMessage(tabId, { type: 'CC_INSTAGRAM_MEDIA', kind });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      detected = await sendTabMessage(tabId, { type: 'CC_INSTAGRAM_MEDIA', kind });
    }

    const urls = Array.isArray(detected?.urls) ? [...new Set(detected.urls)].filter(Boolean) : [];
    const shortcode = safePathPart(payload.externalId || payload.sourceId?.split(':').pop(), 'post');
    const folder = kind === 'video' ? 'video' : 'photos';
    const items = [];

    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      if (!/^https?:/i.test(url)) continue;
      const ext = extensionFor(url, kind);
      const filename = `CC/Instagram/${shortcode}/${folder}/${String(index + 1).padStart(2, '0')}.${ext}`;
      const downloadId = await downloadUrl(url, filename);
      items.push({
        kind,
        url,
        filename,
        downloadId,
        downloadedAt: new Date().toISOString(),
      });
    }

    await restoreCallerFocus(caller);
    return {
      kind,
      items,
      counts: detected?.counts || null,
      pageUrl: detected?.pageUrl || payload.url,
    };
  } finally {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // The user may have closed the worker tab.
    }
    await restoreCallerFocus(caller);
  }
}

function callerFromSender(sender) {
  return {
    tabId: sender.tab?.id || null,
    windowId: sender.tab?.windowId || null,
    index: Number.isInteger(sender.tab?.index) ? sender.tab.index : null,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CC_HELPER_BRIDGE_READY') {
    setConnectedBadge(sender.tab?.id);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== 'CC_HELPER_REQUEST') return false;

  (async () => {
    setConnectedBadge(sender.tab?.id);

    if (message.action === 'ping') {
      return { version: chrome.runtime.getManifest().version, capabilities: ['instagram', 'instagram-media-download'] };
    }
    if (message.action === 'instagram.collect') {
      return await collectInstagram(message.payload || {}, callerFromSender(sender));
    }
    if (message.action === 'instagram.downloadMedia') {
      return await downloadInstagramMedia(message.payload || {}, callerFromSender(sender));
    }
    if (message.action === 'download.open') {
      const downloadId = Number(message.payload?.downloadId || 0);
      if (!downloadId) throw new Error('Downloaded file ID is missing.');
      await chrome.downloads.open(downloadId);
      return { opened: true };
    }
    throw new Error(`Unsupported helper action: ${message.action}`);
  })().then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error?.message || String(error) }),
  );

  return true;
});
