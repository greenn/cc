(() => {
  if (window.__CC_HELPER_BRIDGE_INSTALLED__) return;
  window.__CC_HELPER_BRIDGE_INSTALLED__ = true;

  chrome.runtime.sendMessage({ type: 'CC_HELPER_BRIDGE_READY' }, () => {
    void chrome.runtime.lastError;
  });

  window.postMessage({ source: 'cc-helper', type: 'CC_HELPER_READY', version: chrome.runtime.getManifest().version }, '*');

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'CC_HELPER_PROGRESS') return false;
    window.postMessage({
      source: 'cc-helper',
      type: 'CC_HELPER_PROGRESS',
      sourceId: message.sourceId || '',
      progress: message.progress || {},
    }, '*');
    return false;
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== 'cc-app' || message.type !== 'CC_HELPER_REQUEST') return;

    chrome.runtime.sendMessage({
      type: 'CC_HELPER_REQUEST',
      id: message.id,
      action: message.action,
      payload: message.payload || {},
    }, (response) => {
      const error = chrome.runtime.lastError;
      window.postMessage({
        source: 'cc-helper',
        type: 'CC_HELPER_RESPONSE',
        id: message.id,
        ok: !error && Boolean(response?.ok),
        result: response?.result,
        error: error?.message || response?.error || null,
      }, '*');
    });
  });
})();
