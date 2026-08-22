let nextRequestId = 1;

export function helperRequest(action, payload = {}, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const id = `cc-${Date.now()}-${nextRequestId++}`;
    let timer = null;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (timer) clearTimeout(timer);
    };

    const onMessage = (event) => {
      if (event.source !== window) return;
      const message = event.data;
      if (!message || message.source !== 'cc-helper' || message.type !== 'CC_HELPER_RESPONSE' || message.id !== id) return;
      cleanup();
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error || 'Browser helper request failed.'));
    };

    window.addEventListener('message', onMessage);
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('CC browser helper is not installed, not enabled, or did not answer in time.'));
    }, timeoutMs);

    window.postMessage({
      source: 'cc-app',
      type: 'CC_HELPER_REQUEST',
      id,
      action,
      payload,
    }, '*');
  });
}

export async function checkHelper() {
  return helperRequest('ping', {}, 3000);
}
