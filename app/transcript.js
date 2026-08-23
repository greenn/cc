import { store } from './store.js';
import {
  checkLocalWhisper,
  createLocalWhisperJob,
  getLocalWhisperJob,
  transcribeWithLocalWhisper,
} from './whisper-settings.js';

const DEFAULT_BACKEND_URL = 'https://backend83.nadube.ru/cc';
const $ = (selector) => document.querySelector(selector);

const button = $('#transcribe-button');
const dialog = $('#transcript-dialog');
const title = $('#transcript-title');
const meta = $('#transcript-meta');
const output = $('#transcript-text');
const errorBox = $('#transcript-error');
const runButton = $('#transcript-run');
const copyButton = $('#transcript-copy');
const minimizeButton = $('#transcript-minimize');
const taskChip = $('#transcript-task-chip');
const progressBox = $('#transcript-progress');
const progressLabel = $('#transcript-progress-label');
const progressPercent = $('#transcript-progress-percent');
const progressFill = $('#transcript-progress-fill');
const progressNote = $('#transcript-progress-note');
const sourcesList = $('#sources-list');

const pollingSources = new Set();
let activeSourceId = null;

const ACTIVE_STATUSES = new Set(['checking_captions', 'queued', 'running', 'legacy_running']);

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function currentSource() {
  const active = document.querySelector('.source-item.is-active');
  if (!active?.dataset.sourceId) return null;
  return store.getSource(active.dataset.sourceId);
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function ageSeconds(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

function formatAge(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function progressValue(source) {
  const raw = source?.transcriptJobProgress;
  const present = raw !== null && raw !== undefined && raw !== '';
  const number = Number(raw);
  return present && Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function isJobActive(source) {
  return Boolean(source && ACTIVE_STATUSES.has(source.transcriptJobStatus));
}

function resultMeta(source) {
  const segments = Array.isArray(source?.transcriptSegments) ? source.transcriptSegments : [];
  const method = source?.transcriptMethod === 'whisper'
    ? 'Local Whisper'
    : source?.transcriptMethod === 'captions'
      ? 'YouTube captions'
      : 'Transcript';
  const language = source?.transcriptLanguage ? ` · ${source.transcriptLanguage}` : '';
  const generated = source?.transcriptGenerated && source?.transcriptMethod === 'captions' ? ' · auto-generated captions' : '';
  return `${method}${language}${generated}${segments.length ? ` · ${segments.length} segments` : ''}`;
}

function phaseName(source) {
  const phase = source?.transcriptJobPhase;
  const names = {
    checking_captions: 'Checking YouTube captions',
    queued: 'Queued',
    starting: 'Starting local Whisper',
    preparing_audio: 'Preparing audio',
    downloading_audio: 'Downloading audio',
    download_retry: 'Retrying audio download',
    loading_model: 'Loading Whisper model',
    transcribing: 'Recognizing speech',
    legacy: 'Recognizing speech',
    error: 'Recognition failed',
  };
  return names[phase] || source?.transcriptJobMessage || 'Recognizing';
}

function setError(message = '') {
  if (!errorBox) return;
  errorBox.hidden = !message;
  errorBox.textContent = message;
}

function renderJobState(source) {
  const active = isJobActive(source);
  const failed = source?.transcriptJobStatus === 'error';
  const progress = progressValue(source);
  const hasProgress = progress != null;
  const heartbeatAge = ageSeconds(source?.transcriptJobHeartbeatAt);
  const progressAge = ageSeconds(source?.transcriptJobLastProgressAt);
  const heartbeatMissing = active && source?.transcriptJobStatus === 'running' && heartbeatAge != null && heartbeatAge > 20;
  const progressQuiet = active && source?.transcriptJobStatus === 'running' && progressAge != null && progressAge > 120;
  const modelLoading = source?.transcriptJobPhase === 'loading_model';
  const stalled = heartbeatMissing || (progressQuiet && !modelLoading);

  progressBox.hidden = !(active || failed);
  progressBox.classList.toggle('is-stalled', stalled || failed);
  minimizeButton.hidden = !active;
  runButton.disabled = active;

  if (active || failed) {
    progressLabel.textContent = failed ? 'Recognition failed' : phaseName(source);
    progressPercent.textContent = hasProgress ? `${Math.round(progress)}%` : '—';
    progressFill.style.width = `${hasProgress ? progress : 0}%`;

    let note = source?.transcriptJobMessage || 'Recognition continues if this window is minimized.';
    if (heartbeatMissing) {
      note = `No worker heartbeat for ${formatAge(heartbeatAge)}. The Python process may be stuck or stopped.`;
    } else if (progressQuiet && modelLoading) {
      note = `Worker is alive. Model loading/download has shown no measurable progress for ${formatAge(progressAge)}; the first run can take several minutes.`;
    } else if (progressQuiet) {
      note = `Worker is alive, but measurable progress has not changed for ${formatAge(progressAge)}.`;
    } else if (active && source?.transcriptJobStatus !== 'checking_captions') {
      const heartbeat = heartbeatAge == null ? '' : ` Worker heartbeat ${formatAge(heartbeatAge)} ago.`;
      note = `${note}${heartbeat} You can minimize this window and keep using CC.`;
    }
    progressNote.textContent = note;
  }

  if (failed) setError(source?.transcriptJobError || source?.transcriptJobMessage || 'Recognition failed.');
  else setError('');

  if (active) {
    meta.textContent = source?.transcriptJobMessage || phaseName(source);
    runButton.textContent = 'Recognizing…';
  } else if (failed) {
    meta.textContent = 'Recognition stopped with an error. You can retry.';
    runButton.textContent = source?.transcript ? 'Recognize again' : 'Retry';
  } else {
    meta.textContent = source?.transcript ? resultMeta(source) : 'YouTube captions are checked first. If none exist, CC can use local Whisper.';
    runButton.textContent = source?.transcript ? 'Recognize again' : 'Recognize';
  }
}

function renderTranscript(source) {
  title.textContent = source?.title || 'YouTube transcript';
  const segments = Array.isArray(source?.transcriptSegments) ? source.transcriptSegments : [];

  if (segments.length) {
    output.value = segments.map((segment) => `[${formatTime(segment.start)}] ${segment.text}`).join('\n');
  } else {
    output.value = source?.transcript || '';
  }

  copyButton.disabled = !output.value;
  renderJobState(source);
}

function syncButton() {
  const source = currentSource();
  const isYouTube = source?.platform === 'youtube';
  button.hidden = !isYouTube;
  taskChip.hidden = !isYouTube || (!isJobActive(source) && source?.transcriptJobStatus !== 'error');
  activeSourceId = isYouTube ? source.id : activeSourceId;

  if (!isYouTube) return;

  const active = isJobActive(source);
  const progress = progressValue(source);
  const hasProgress = progress != null;
  const failed = source?.transcriptJobStatus === 'error';

  if (active) {
    if (source.transcriptJobStatus === 'checking_captions') button.textContent = 'Checking captions…';
    else if (source.transcriptJobStatus === 'queued') button.textContent = 'Recognition queued…';
    else button.textContent = hasProgress ? `Recognizing ${Math.round(progress)}%` : 'Recognizing…';
  } else {
    button.textContent = source.transcript ? 'Transcript' : 'Recognize video';
  }

  if (!taskChip.hidden) {
    taskChip.classList.toggle('is-running', active && !failed);
    taskChip.classList.toggle('is-warning', failed);
    taskChip.textContent = failed
      ? 'Recognition failed'
      : source.transcriptJobStatus === 'queued'
        ? 'Queued'
        : hasProgress ? `Recognition ${Math.round(progress)}%` : 'Recognizing…';
  }

  if (dialog.open && activeSourceId === source.id) renderTranscript(source);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function clearJobPatch() {
  return {
    transcriptJobId: null,
    transcriptJobMode: null,
    transcriptJobStatus: null,
    transcriptJobPhase: null,
    transcriptJobProgress: null,
    transcriptJobPhaseProgress: null,
    transcriptJobMessage: null,
    transcriptJobHeartbeatAt: null,
    transcriptJobLastProgressAt: null,
    transcriptJobError: null,
  };
}

function saveTranscript(source, data) {
  store.updateSource(source.id, {
    transcript: data.text || '',
    transcriptSegments: Array.isArray(data.segments) ? data.segments : [],
    transcriptMethod: data.method || 'captions',
    transcriptLanguage: data.language || '',
    transcriptGenerated: Boolean(data.generated),
    transcriptUpdatedAt: new Date().toISOString(),
    ...clearJobPatch(),
  });
  const updated = store.getSource(source.id);
  if (dialog.open && activeSourceId === source.id) renderTranscript(updated);
  syncButton();
}

function markJobError(sourceId, message) {
  const source = store.getSource(sourceId);
  if (!source) return;
  store.updateSource(sourceId, {
    transcriptJobId: null,
    transcriptJobStatus: 'error',
    transcriptJobPhase: 'error',
    transcriptJobMessage: message,
    transcriptJobError: message,
    transcriptJobHeartbeatAt: new Date().toISOString(),
  });
  if (dialog.open && activeSourceId === sourceId) renderTranscript(store.getSource(sourceId));
  syncButton();
}

function jobPatch(job) {
  return {
    transcriptJobId: job.id,
    transcriptJobMode: 'jobs',
    transcriptJobStatus: job.status,
    transcriptJobPhase: job.phase,
    transcriptJobProgress: job.progress,
    transcriptJobPhaseProgress: job.phaseProgress,
    transcriptJobMessage: job.message || '',
    transcriptJobHeartbeatAt: job.heartbeatAt || job.updatedAt || null,
    transcriptJobLastProgressAt: job.lastProgressAt || null,
    transcriptJobError: job.error || null,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollLocalJob(sourceId) {
  if (pollingSources.has(sourceId)) return;
  pollingSources.add(sourceId);

  try {
    while (true) {
      const source = store.getSource(sourceId);
      if (!source?.transcriptJobId || source.transcriptJobMode !== 'jobs') return;
      const jobId = source.transcriptJobId;

      let job;
      try {
        job = await getLocalWhisperJob(jobId);
      } catch (error) {
        const message = error.status === 404
          ? 'The local Whisper service no longer knows this job. It was probably restarted; run recognition again.'
          : `Could not check recognition state: ${error.message || error}`;
        markJobError(sourceId, message);
        return;
      }

      const latest = store.getSource(sourceId);
      if (!latest || latest.transcriptJobId !== jobId) return;
      store.updateSource(sourceId, jobPatch(job));

      if (job.status === 'done') {
        if (!job.result?.ok) {
          markJobError(sourceId, 'Recognition finished without a usable result.');
          return;
        }
        saveTranscript(store.getSource(sourceId), {
          ...job.result,
          method: 'whisper',
          generated: true,
        });
        return;
      }

      if (job.status === 'error') {
        markJobError(sourceId, job.error || job.message || 'Local Whisper recognition failed.');
        return;
      }

      if (dialog.open && activeSourceId === sourceId) renderTranscript(store.getSource(sourceId));
      syncButton();
      await delay(document.visibilityState === 'visible' ? 1000 : 3000);
    }
  } finally {
    pollingSources.delete(sourceId);
  }
}

async function runLegacyWhisper(source) {
  const now = new Date().toISOString();
  store.updateSource(source.id, {
    transcriptJobId: null,
    transcriptJobMode: 'legacy',
    transcriptJobStatus: 'legacy_running',
    transcriptJobPhase: 'legacy',
    transcriptJobProgress: null,
    transcriptJobPhaseProgress: null,
    transcriptJobMessage: 'Older local Whisper service detected. Recognition is running, but detailed progress is unavailable. Restart start-whisper.cmd after git pull to enable progress.',
    transcriptJobHeartbeatAt: now,
    transcriptJobLastProgressAt: now,
    transcriptJobError: null,
  });
  renderTranscript(store.getSource(source.id));
  syncButton();

  try {
    const local = await transcribeWithLocalWhisper(source.url, null);
    saveTranscript(store.getSource(source.id), {
      ...local,
      ok: true,
      method: 'whisper',
      generated: true,
    });
  } catch (error) {
    markJobError(source.id, error.message || 'Local Whisper recognition failed.');
  }
}

async function startLocalWhisper(source) {
  meta.textContent = 'No usable YouTube captions. Checking local Whisper…';
  const status = await checkLocalWhisper({ quiet: true });
  if (!status.online) {
    throw new Error('This video has no usable YouTube captions and local Whisper is offline. Start start-whisper.cmd on this computer.');
  }

  try {
    const job = await createLocalWhisperJob(source.url, null);
    store.updateSource(source.id, jobPatch(job));
    if (dialog.open && activeSourceId === source.id) renderTranscript(store.getSource(source.id));
    syncButton();
    pollLocalJob(source.id);
  } catch (error) {
    if (error.status === 404 || error.status === 405) {
      void runLegacyWhisper(source);
      return;
    }
    throw error;
  }
}

async function recognize(source) {
  if (!source || source.platform !== 'youtube' || isJobActive(source)) return;

  const settings = store.getSettings();
  const base = normalizeBaseUrl(settings.backendUrl || DEFAULT_BACKEND_URL);
  const token = String(settings.backendToken || '').trim();
  const now = new Date().toISOString();

  store.updateSource(source.id, {
    transcriptJobId: null,
    transcriptJobMode: null,
    transcriptJobStatus: 'checking_captions',
    transcriptJobPhase: 'checking_captions',
    transcriptJobProgress: 1,
    transcriptJobPhaseProgress: 0,
    transcriptJobMessage: token ? 'Checking YouTube captions first…' : 'Backend token is not configured. Switching to local Whisper…',
    transcriptJobHeartbeatAt: now,
    transcriptJobLastProgressAt: now,
    transcriptJobError: null,
  });
  setError('');
  renderTranscript(store.getSource(source.id));
  syncButton();

  try {
    if (!token) {
      await startLocalWhisper(store.getSource(source.id));
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(`${base}/api/transcript.php`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          videoId: source.externalId,
          url: source.url,
          preferredLanguages: ['ru', 'en'],
          captionsOnly: true,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    let data = await readJson(response);
    if (response.ok && data.ok) {
      saveTranscript(store.getSource(source.id), data);
      return;
    }

    const captionsUnavailable = data.code === 'captions_unavailable'
      || data.code === 'whisper_not_configured'
      || String(data.error || '').includes('no YouTube captions')
      || String(data.error || '').includes('empty or unsupported caption track');
    const backendUnavailable = response.status === 404 || response.status === 405 || response.status >= 500;

    if (!captionsUnavailable && !backendUnavailable) {
      throw new Error(data.error || `Transcript request failed (${response.status}).`);
    }

    await startLocalWhisper(store.getSource(source.id));
  } catch (error) {
    if (error.name === 'AbortError') {
      try {
        await startLocalWhisper(store.getSource(source.id));
        return;
      } catch (fallbackError) {
        markJobError(source.id, `Caption check timed out, and local fallback failed: ${fallbackError.message || fallbackError}`);
        return;
      }
    }
    markJobError(source.id, error.message || 'Could not recognize this video.');
  }
}

function openTranscript(source) {
  if (!source || source.platform !== 'youtube') return;
  activeSourceId = source.id;
  setError('');
  renderTranscript(source);
  if (!dialog.open) dialog.showModal();
}

button?.addEventListener('click', () => {
  const source = currentSource();
  if (!source || source.platform !== 'youtube') return;
  openTranscript(source);

  if (!source.transcript && !isJobActive(source)) {
    void recognize(source);
  }
});

taskChip?.addEventListener('click', () => {
  const source = currentSource();
  if (source?.platform === 'youtube') openTranscript(source);
});

runButton?.addEventListener('click', (event) => {
  event.preventDefault();
  const source = store.getSource(activeSourceId) || currentSource();
  if (!source || isJobActive(source)) return;
  void recognize(source);
});

minimizeButton?.addEventListener('click', (event) => {
  event.preventDefault();
  if (dialog.open) dialog.close();
});

copyButton?.addEventListener('click', async (event) => {
  event.preventDefault();
  if (!output.value) return;
  try {
    await navigator.clipboard.writeText(output.value);
    copyButton.textContent = 'Copied';
    setTimeout(() => { copyButton.textContent = 'Copy text'; }, 1200);
  } catch {
    output.focus();
    output.select();
  }
});

function resumeJobs() {
  for (const source of store.getSources()) {
    if (source.platform !== 'youtube') continue;
    if (source.transcriptJobId && source.transcriptJobMode === 'jobs' && ['queued', 'running'].includes(source.transcriptJobStatus)) {
      pollLocalJob(source.id);
      continue;
    }
    if (source.transcriptJobStatus === 'legacy_running') {
      markJobError(source.id, 'The page was reloaded while using the old synchronous Whisper service. Restart start-whisper.cmd after git pull, then retry recognition.');
      continue;
    }
    if (source.transcriptJobStatus === 'checking_captions') {
      store.updateSource(source.id, { ...clearJobPatch() });
    }
  }
  syncButton();
}

if (sourcesList) {
  new MutationObserver(syncButton).observe(sourcesList, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

document.addEventListener('click', () => setTimeout(syncButton, 0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeJobs();
});

resumeJobs();
syncButton();
