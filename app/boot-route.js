import { store } from './store.js';

// app.js historically selects the first stored source before the URL router runs.
// On the Sources/Home route that briefly renders a full comment list (and starts
// many avatar requests) before the router switches back to Sources. With large
// sources this can make startup look frozen. Until the core router owns initial
// state directly, make only that one boot-time selection route-aware.
const url = new URL(window.location.href);
const requestedSourceId = url.searchParams.get('source');
const originalGetSources = store.getSources.bind(store);
let getSourcesCalls = 0;

store.getSources = (...args) => {
  getSourcesCalls += 1;
  const sources = originalGetSources(...args);

  // app.js call #1 is its migration loop. Call #2 chooses currentSourceId.
  if (getSourcesCalls !== 2) return sources;

  // Restore normal store behavior immediately after the boot selection call.
  store.getSources = originalGetSources;

  if (!requestedSourceId) {
    console.info('[CC 0.4.6] boot route: global view; skipped initial comment render');
    return [];
  }

  const requested = sources.find((source) => source.id === requestedSourceId);
  if (!requested) {
    console.warn('[CC 0.4.6] boot route: requested source not found; starting at Sources', requestedSourceId);
    return [];
  }

  console.info('[CC 0.4.6] boot route: opening requested source directly', requestedSourceId);
  return [requested, ...sources.filter((source) => source.id !== requestedSourceId)];
};
