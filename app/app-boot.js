const VERSION = '0.4.8';

const modules = [
  './boot-route.js',
  './avatar-policy.js',
  './app.js',
  './comment-ui.js',
  './vk-settings.js',
  './helper-settings.js',
  './backend-settings.js',
  './whisper-settings.js',
  './transcript.js',
];

console.info(`[CC ${VERSION}] runtime bootstrap`, { base: import.meta.url });

for (const modulePath of modules) {
  const url = new URL(modulePath, import.meta.url);
  url.searchParams.set('v', VERSION);
  console.info(`[CC ${VERSION}] loading module`, url.href);
  try {
    await import(url.href);
  } catch (error) {
    console.error(`[CC ${VERSION}] module failed`, { module: url.href, error });
    throw error;
  }
}

window.__CC_RUNTIME_READY__ = true;
console.info(`[CC ${VERSION}] runtime ready`);
