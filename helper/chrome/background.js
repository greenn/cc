const CC_PAGE_PATTERNS = [
  'https://greenn.github.io/cc/*',
  'https://*.nadube.ru/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
];

const workerSessions = new Map();
const closedWorkers = new Map();

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

function sendCcMessage(tabId, message) {
  if (!tabId) return Promise.resolve(false);
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      const error = chrome.runtime.lastError;
      resolve(!error);
    });
  });
}

async function broadcastCcMessage(message) {
  const tabs = await chrome.tabs.query({ url: CC_PAGE_PATTERNS });
  await Promise.all(tabs.filter((tab) => tab.id).map((tab) => sendCcMessage(tab.id, message)));
}

async function sendProgress(caller, sourceId, progress) {
  const message = {
    type: 'CC_HELPER_PROGRESS',
    sourceId: sourceId || '',
    progress: progress || {},
  };
  if (caller?.tabId && await sendCcMessage(caller.tabId, message)) return;
  await broadcastCcMessage(message);
}

async function forwardWorkerProgress(workerTabId, sourceId, progress) {
  const session = workerSessions.get(workerTabId);
  await sendProgress(session?.caller || null, sourceId || session?.sourceId || '', progress || {});
}

async function forwardWorkerBatch(workerTabId, message) {
  const session = workerSessions.get(workerTabId);
  const sourceId = String(message.sourceId || session?.sourceId || '');
  if (!sourceId) return;
  const comments = Array.isArray(message.comments) ? message.comments : [];
  if (session) session.streamed += comments.length;
  const outgoing = {
    type: 'CC_HELPER_COMMENT_BATCH',
    sourceId,
    passId: message.passId || session?.passId || '',
    comments,
    meta: message.meta || {},
  };
  if (session?.caller?.tabId && await sendCcMessage(session.caller.tabId, outgoing)) return;
  await broadcastCcMessage(outgoing);
}

setGlobalBadge();

chrome.runtime.onInstalled.addListener(() => {
  setGlobalBadge();
  injectBridgeIntoOpenCcTabs();
});

chrome.runtime.onStartup.addListener(() => {
  setGlobalBadge();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const session = workerSessions.get(tabId);
  if (session) session.manualFocus = true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = workerSessions.get(tabId);
  if (!session || session.closingByHelper) return;
  closedWorkers.set(tabId, Date.now());
  setTimeout(() => closedWorkers.delete(tabId), 60 * 1000);
  void sendProgress(session.caller, session.sourceId, {
    passId: session.passId,
    phase: 'interrupted',
    collected: session.lastCollected || 0,
    streamed: session.streamed || 0,
    reason: 'worker-closed',
    timestamp: Date.now(),
  });
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

  const passId = `${payload.sourceId || 'instagram'}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await sendProgress(caller, payload.sourceId, {
    passId,
    phase: 'opening',
    collected: 0,
    streamed: 0,
    clicks: 0,
    scrollMoves: 0,
    step: 0,
    maxSteps: 0,
  });

  const tabId = await createInstagramWorkerTab(payload.url, caller);
  workerSessions.set(tabId, {
    caller,
    sourceId: payload.sourceId || '',
    passId,
    streamed: 0,
    lastCollected: 0,
    manualFocus: false,
    closingByHelper: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 1200));

  try {
    const request = {
      type: 'CC_INSTAGRAM_COLLECT',
      url: payload.url,
      sourceId: payload.sourceId,
      maxClicks: payload.maxClicks || 40,
      passId,
    };

    try {
      const result = await sendTabMessage(tabId, request);
      return await decorateCollectResult(tabId, result);
    } catch (error) {
      if (closedWorkers.has(tabId)) {
        throw new Error('Instagram worker tab was closed. Everything already streamed to CC was kept.');
      }
      await sendProgress(caller, payload.sourceId, {
        passId,
        phase: 'retrying',
        collected: workerSessions.get(tabId)?.lastCollected || 0,
        streamed: workerSessions.get(tabId)?.streamed || 0,
        clicks: 0,
        scrollMoves: 0,
        step: 0,
        maxSteps: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (closedWorkers.has(tabId)) {
        throw new Error('Instagram worker tab was closed. Everything already streamed to CC was kept.');
      }
      const result = await sendTabMessage(tabId, request);
      return await decorateCollectResult(tabId, result);
    }
  } finally {
    const session = workerSessions.get(tabId);
    if (session) session.closingByHelper = true;
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // The user may have closed the temporary tab first.
    }
    if (!session?.manualFocus) await restoreCallerFocus(caller);
    workerSessions.delete(tabId);
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

  if (message?.type === 'CC_INSTAGRAM_PROGRESS') {
    const tabId = sender.tab?.id || 0;
    const session = workerSessions.get(tabId);
    if (session) {
      session.lastCollected = Math.max(session.lastCollected || 0, Number(message.progress?.collected || 0));
    }
    void forwardWorkerProgress(tabId, message.sourceId, message.progress || {});
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'CC_INSTAGRAM_COMMENT_BATCH') {
    void forwardWorkerBatch(sender.tab?.id || 0, message);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== 'CC_HELPER_REQUEST') return false;

  (async () => {
    setConnectedBadge(sender.tab?.id);

    if (message.action === 'ping') {
      return {
        version: chrome.runtime.getManifest().version,
        capabilities: [
          'instagram',
          'instagram-media-download',
          'instagram-progress',
          'instagram-comment-stream',
          'instagram-manual-worker',
        ],
      };
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
