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

  // Chrome normally respects active:false, but re-assert the CC tab immediately
  // and again after Instagram finishes loading. This also protects against a
  // page/window attempting to steal focus while the helper is working.
  await restoreCallerFocus(caller);
  await waitForTabComplete(tab.id);
  await restoreCallerFocus(caller);

  return tab.id;
}

async function collectInstagram(payload, caller) {
  if (!payload?.url) throw new Error('Instagram URL is missing.');

  // Never reuse or navigate a user's existing Instagram tab. A dedicated
  // temporary inactive tab is much safer: Refresh cannot hijack another tab,
  // and the worker tab is always closed when collection finishes.
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
      return result;
    } catch (error) {
      // The content script may not yet be ready immediately after navigation.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await restoreCallerFocus(caller);
      const result = await sendTabMessage(tabId, {
        type: 'CC_INSTAGRAM_COLLECT',
        url: payload.url,
        sourceId: payload.sourceId,
        maxClicks: payload.maxClicks || 40,
      });
      await restoreCallerFocus(caller);
      return result;
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
      return { version: chrome.runtime.getManifest().version, capabilities: ['instagram'] };
    }
    if (message.action === 'instagram.collect') {
      const caller = {
        tabId: sender.tab?.id || null,
        windowId: sender.tab?.windowId || null,
        index: Number.isInteger(sender.tab?.index) ? sender.tab.index : null,
      };
      return await collectInstagram(message.payload || {}, caller);
    }
    throw new Error(`Unsupported helper action: ${message.action}`);
  })().then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error?.message || String(error) }),
  );

  return true;
});
