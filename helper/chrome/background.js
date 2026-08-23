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

async function getInstagramTab(targetUrl) {
  const target = new URL(targetUrl);
  const marker = target.pathname.split('/').filter(Boolean).find((part) => part.length > 5) || target.pathname;
  const tabs = await chrome.tabs.query({ url: ['https://www.instagram.com/*', 'https://instagram.com/*'] });
  const existing = tabs.find((tab) => tab.url?.includes(marker));
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: targetUrl });
    await waitForTabComplete(existing.id);
    return existing.id;
  }

  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  if (!tab.id) throw new Error('Could not open Instagram tab.');
  await waitForTabComplete(tab.id);
  return tab.id;
}

async function collectInstagram(payload) {
  if (!payload?.url) throw new Error('Instagram URL is missing.');
  const tabId = await getInstagramTab(payload.url);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  try {
    return await sendTabMessage(tabId, {
      type: 'CC_INSTAGRAM_COLLECT',
      url: payload.url,
      sourceId: payload.sourceId,
      maxClicks: payload.maxClicks || 40,
    });
  } catch (error) {
    // The content script may not yet be ready immediately after navigation.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return await sendTabMessage(tabId, {
      type: 'CC_INSTAGRAM_COLLECT',
      url: payload.url,
      sourceId: payload.sourceId,
      maxClicks: payload.maxClicks || 40,
    });
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
      return await collectInstagram(message.payload || {});
    }
    throw new Error(`Unsupported helper action: ${message.action}`);
  })().then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error?.message || String(error) }),
  );

  return true;
});
