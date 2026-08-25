const VERSION = '0.5.22';

const modules = [
  './boot-route.js',
  './avatar-policy.js',
  './app.js',
  './source-groups.js',
  './source-meta.js',
  './instagram-media.js',
  './instagram-stream.js',
  './instagram-progress.js',
  './instagram-worker-focus.js',
  './comment-accounts.js',
  './vk-settings.js',
  './helper-settings.js',
  './backend-settings.js',
  './whisper-settings.js',
  './transcript.js',
  './comment-ui.js',
  './comment-media.js',
  './comment-gestures.js',
  './comment-translate.js',
  './shortcuts.js',
];

const loadedModules = window.__CC_LOADED_MODULES__ ||= new Set();
console.info(`[CC ${VERSION}] runtime bootstrap`, { base: import.meta.url, alreadyLoaded: [...loadedModules] });

for (const modulePath of modules) {
  if (loadedModules.has(modulePath)) continue;
  const url = new URL(modulePath, import.meta.url);
  url.searchParams.set('v', VERSION);
  console.info(`[CC ${VERSION}] loading module`, url.href);
  try {
    await import(url.href);
    loadedModules.add(modulePath);
  } catch (error) {
    console.error(`[CC ${VERSION}] module failed`, { module: url.href, error });
    throw error;
  }
}

window.__CC_RUNTIME_READY__ = true;
console.info(`[CC ${VERSION}] runtime ready`);
