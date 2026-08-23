import { store } from './store.js';
import {
  checkLocalWhisper,
  createLocalWhisperJob,
  getLocalWhisperJob,
} from './whisper-settings.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const MODELS = [
  { id: 'small', label: 'small', tabLabel: 'Text small' },
  { id: 'medium', label: 'medium', tabLabel: 'Text medium' },
  { id: 'large-v3', label: 'large-v3', tabLabel: 'Text large-v3' },
];
const MODEL_IDS = new Set(MODELS.map((item) => item.id));
const ACTIVE_STATUSES = new Set(['queued', 'running']);
const pollingKeys = new Set();

let activeDialogSourceId = null;
let activeDialogModel = 'small';
let activeResultSourceId = null;
let activeResultModel = null;
let lastCurrentSourceId = null;

function modelInfo(model) {
  return MODELS.find((item) => item.id === model) || MODELS[0];
}

function currentSource() {
  const active = document.querySelector('.source-item.is-active');
  if (!active?.dataset.sourceId) return null;
  return store.getSource(active.dataset.sourceId);
}

function resultsFor(source) {
  return source?.transcripts && typeof source.transcripts === 'object' ? source.transcripts : {};
}

function jobsFor(source) {
  return source?.transcriptionJobs && typeof source.transcriptionJobs === 'object' ? source.transcriptionJobs : {};
}

function getResult(source, model) {
  return resultsFor(source)[model] || null;
}

function getJob(source, model) {
  return jobsFor(source)[model] || null;
}

function isJobActive(job) {
  return Boolean(job && ACTIVE_STATUSES.has(job.status));
}

function setModelJob(sourceId, model, nextJob) {
  const source = store.getSource(sourceId);
  if (!source) return null;
  const jobs = { ...jobsFor(source) };
  if (nextJob == null) delete jobs[model];
  else jobs[model] = { ...(jobs[model] || {}), ...nextJob, model };
  return store.updateSource(sourceId, { transcriptionJobs: jobs });
}

function setModelResult(sourceId, model, result) {
  const source = store.getSource(sourceId);
  if (!source) return null;
  const transcripts = { ...resultsFor(source), [model]: result };
  return store.updateSource(sourceId, {
    transcripts,
    transcript: result.text || '',
    transcriptSegments: Array.isArray(result.segments) ? result.segments : [],
    transcriptMethod: 'whisper',
    transcriptLanguage: result.language || '',
    transcriptGenerated: true,
    transcriptModel: model,
    transcriptUpdatedAt: result.updatedAt,
  });
}

function migrateLegacyState() {
  for (const source of store.getSources()) {
    if (source.platform !== 'youtube') continue;
    let transcripts = resultsFor(source);
    let jobs = jobsFor(source);
    let changed = false;

    if (source.transcript && source.transcriptMethod === 'whisper' && !transcripts.small) {
      transcripts = {
        ...transcripts,
        small: {
          text: source.transcript,
          segments: Array.isArray(source.transcriptSegments) ? source.transcriptSegments : [],
          method: 'whisper',
          model: source.transcriptModel || 'small',
          language: source.transcriptLanguage || '',
          generated: true,
          updatedAt: source.transcriptUpdatedAt || new Date().toISOString(),
        },
      };
      changed = true;
    }

    if (
      source.transcriptJobId
      && ['queued', 'running'].includes(source.transcriptJobStatus)
      && !jobs.small
    ) {
      jobs = {
        ...jobs,
        small: {
          id: source.transcriptJobId,
          model: 'small',
          status: source.transcriptJobStatus,
          phase: source.transcriptJobPhase,
          progress: source.transcriptJobProgress,
          phaseProgress: source.transcriptJobPhaseProgress,
          message: source.transcriptJobMessage,
          heartbeatAt: source.transcriptJobHeartbeatAt,
          lastProgressAt: source.transcriptJobLastProgressAt,
          error: source.transcriptJobError,
        },
      };
      changed = true;
    }

    if (changed) store.updateSource(source.id, { transcripts, transcriptionJobs: jobs });
  }
}

function formatClock(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '—';
  if (value < 60) return `${value.toFixed(value < 10 ? 1 : 0)} s`;
  return formatClock(value);
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

function transcriptText(result) {
  const segments = Array.isArray(result?.segments) ? result.segments : [];
  if (segments.length) {
    return segments.map((segment) => `[${formatClock(segment.start)}] ${segment.text}`).join('\n');
  }
  return result?.text || '';
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
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function phaseName(job) {
  const names = {
    queued: 'Queued',
    starting: 'Starting local Whisper',
    preparing_audio: 'Preparing audio',
    downloading_audio: 'Downloading audio',
    download_retry: 'Retrying audio download',
    loading_model: 'Loading Whisper model',
    transcribing: 'Recognizing speech',
    done: 'Done',
    error: 'Recognition failed',
  };
  return names[job?.phase] || job?.message || 'Recognizing';
}

function ensureUi() {
  const oldButton = $('#transcribe-button');
  const headerActions = oldButton?.parentElement || $('.header-actions');
  if (oldButton) oldButton.hidden = true;

  if (headerActions && !$('#recognize-model-group')) {
    const group = document.createElement('div');
    group.id = 'recognize-model-group';
    group.className = 'recognize-model-group';
    group.hidden = true;
    group.innerHTML = MODELS.map((item) => `
      <button class="model-recognize-button" type="button" data-recognize-model="${item.id}" title="Recognize this video with Whisper ${item.label}">Recognize ${item.label}</button>
    `).join('');
    headerActions.appendChild(group);
  }

  const topTabs = $('#top-tabs');
  if (topTabs && !$('#transcript-tabs')) {
    const holder = document.createElement('span');
    holder.id = 'transcript-tabs';
    holder.className = 'transcript-tabs';
    topTabs.appendChild(holder);
  }

  const contentArea = $('#content-area');
  if (contentArea && !$('#transcript-result-view')) {
    const view = document.createElement('section');
    view.id = 'transcript-result-view';
    view.className = 'transcript-result-view';
    view.hidden = true;
    view.innerHTML = `
      <div class="transcript-result-head">
        <div>
          <p class="eyebrow" id="transcript-result-eyebrow">Recognized text</p>
          <h2 id="transcript-result-title">Transcript</h2>
        </div>
        <button class="ghost-action" id="transcript-result-copy" type="button">Copy text</button>
      </div>
      <div class="transcript-result-metrics" id="transcript-result-metrics"></div>
      <textarea class="transcript-result-text" id="transcript-result-text" readonly></textarea>
    `;
    const statusBanner = $('#status-banner');
    if (statusBanner?.nextSibling) contentArea.insertBefore(view, statusBanner.nextSibling);
    else contentArea.appendChild(view);
  }

  const dialog = $('#transcript-dialog');
  const errorBox = $('#transcript-error');
  if (dialog && errorBox && !$('#transcript-progress')) {
    const progress = document.createElement('div');
    progress.id = 'transcript-progress';
    progress.className = 'transcript-progress';
    progress.hidden = true;
    progress.innerHTML = `
      <div class="transcript-progress-head"><strong id="transcript-progress-label">Recognizing</strong><span id="transcript-progress-percent">0%</span></div>
      <div class="transcript-progress-track"><span id="transcript-progress-fill"></span></div>
      <p id="transcript-progress-note">The task continues in the background.</p>
    `;
    errorBox.parentElement.insertBefore(progress, errorBox);
  }

  const actions = dialog?.querySelector('.dialog-actions');
  if (actions && !$('#transcript-minimize')) {
    const minimize = document.createElement('button');
    minimize.id = 'transcript-minimize';
    minimize.className = 'ghost-action';
    minimize.type = 'button';
    minimize.textContent = 'Minimize';
    actions.insertBefore(minimize, actions.firstChild);
  }
}

ensureUi();

const dialog = $('#transcript-dialog');
const dialogTitle = $('#transcript-title');
const dialogMeta = $('#transcript-meta');
const dialogOutput = $('#transcript-text');
const dialogError = $('#transcript-error');
const dialogRun = $('#transcript-run');
const dialogCopy = $('#transcript-copy');
const dialogMinimize = $('#transcript-minimize');
const progressBox = $('#transcript-progress');
const progressLabel = $('#transcript-progress-label');
const progressPercent = $('#transcript-progress-percent');
const progressFill = $('#transcript-progress-fill');
const progressNote = $('#transcript-progress-note');
const resultView = $('#transcript-result-view');
const resultTitle = $('#transcript-result-title');
const resultEyebrow = $('#transcript-result-eyebrow');
const resultMetrics = $('#transcript-result-metrics');
const resultText = $('#transcript-result-text');
const resultCopy = $('#transcript-result-copy');
const recognizeGroup = $('#recognize-model-group');
const transcriptTabs = $('#transcript-tabs');
const contentArea = $('#content-area');
const sourcesList = $('#sources-list');

function setDialogError(message = '') {
  if (!dialogError) return;
  dialogError.hidden = !message;
  dialogError.textContent = message;
}

function renderDialog(source, model) {
  if (!source || !MODEL_IDS.has(model)) return;
  const info = modelInfo(model);
  const job = getJob(source, model);
  const result = getResult(source, model);
  const active = isJobActive(job);
  const failed = job?.status === 'error';
  const progress = Number(job?.progress);
  const hasProgress = Number.isFinite(progress);

  dialogTitle.textContent = `${source.title || 'YouTube transcript'} · ${info.label}`;
  dialogOutput.value = transcriptText(result);
  dialogCopy.disabled = !dialogOutput.value;
  dialogRun.disabled = active;
  dialogRun.textContent = result ? `Recognize again · ${info.label}` : `Recognize · ${info.label}`;
  dialogMinimize.hidden = !active;

  progressBox.hidden = !(active || failed);
  progressBox.classList.toggle('is-stalled', failed);
  if (active || failed) {
    progressLabel.textContent = failed ? 'Recognition failed' : `${phaseName(job)} · ${info.label}`;
    progressPercent.textContent = hasProgress ? `${Math.round(progress)}%` : '—';
    progressFill.style.width = `${hasProgress ? Math.max(0, Math.min(100, progress)) : 0}%`;

    const heartbeatAge = ageSeconds(job?.heartbeatAt);
    const progressAge = ageSeconds(job?.lastProgressAt);
    const heartbeatMissing = active && job?.status === 'running' && heartbeatAge != null && heartbeatAge > 20;
    const modelLoading = job?.phase === 'loading_model';
    const progressQuiet = active && job?.status === 'running' && progressAge != null && progressAge > 120;

    if (heartbeatMissing) {
      progressNote.textContent = `No worker heartbeat for ${formatAge(heartbeatAge)}. The Python process may be stopped.`;
      progressBox.classList.add('is-stalled');
    } else if (progressQuiet && modelLoading) {
      progressNote.textContent = `Worker is alive. ${info.label} is still loading/downloading; no measurable progress for ${formatAge(progressAge)}.`;
    } else if (progressQuiet) {
      progressNote.textContent = `Worker is alive, but measurable progress has not changed for ${formatAge(progressAge)}.`;
    } else {
      progressNote.textContent = `${job?.message || 'Recognition is running.'} You can minimize this window and continue using CC.`;
    }
  }

  if (failed) setDialogError(job.error || job.message || 'Recognition failed.');
  else setDialogError('');

  if (active) dialogMeta.textContent = job?.message || `${phaseName(job)} · ${info.label}`;
  else if (result) dialogMeta.textContent = resultSummary(result);
  else dialogMeta.textContent = `Local Whisper ${info.label}. The recognized text will be stored with this YouTube source.`;
}

function resultSummary(result) {
  const parts = [
    `Whisper ${result?.model || '—'}`,
    result?.language ? `language ${result.language}` : '',
    Number.isFinite(Number(result?.totalSeconds)) ? `total ${formatDuration(result.totalSeconds)}` : '',
    Number.isFinite(Number(result?.realtimeFactor)) ? `RTF ${Number(result.realtimeFactor).toFixed(2)}×` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function metric(label, value) {
  return `<div><span>${label}</span><strong>${value}</strong></div>`;
}

function renderMainResult(source, model) {
  const result = getResult(source, model);
  if (!result) return;
  const info = modelInfo(model);
  const languageProbability = Number(result.languageProbability);
  const rtf = Number(result.realtimeFactor);
  const speed = Number.isFinite(rtf) && rtf > 0 ? `${(1 / rtf).toFixed(2)}× realtime` : '—';

  resultEyebrow.textContent = `${source.title || 'YouTube'} · recognized text`;
  resultTitle.textContent = `Whisper ${info.label}`;
  resultMetrics.innerHTML = [
    metric('Model', result.model || info.label),
    metric('Language', result.language ? `${result.language}${Number.isFinite(languageProbability) ? ` · ${(languageProbability * 100).toFixed(1)}%` : ''}` : '—'),
    metric('Audio', formatDuration(result.audioDurationSeconds)),
    metric('Total time', formatDuration(result.totalSeconds)),
    metric('Download', formatDuration(result.downloadSeconds)),
    metric('Model load', formatDuration(result.modelLoadSeconds)),
    metric('Recognition', formatDuration(result.transcriptionSeconds)),
    metric('RTF', Number.isFinite(rtf) ? `${rtf.toFixed(3)}×` : '—'),
    metric('Speed', speed),
    metric('Device', `${result.device || '—'} · ${result.computeType || '—'}`),
    metric('Words', Number.isFinite(Number(result.wordCount)) ? String(result.wordCount) : '—'),
    metric('Segments', Array.isArray(result.segments) ? String(result.segments.length) : '—'),
    metric('Finished', formatTimestamp(result.finishedAt || result.updatedAt)),
  ].join('');
  resultText.value = transcriptText(result);
}

function showResultView(source, model) {
  const result = getResult(source, model);
  if (!result) return;
  activeResultSourceId = source.id;
  activeResultModel = model;
  contentArea?.classList.add('is-transcript-view');
  resultView.hidden = false;
  $$('#top-tabs .top-tab').forEach((button) => button.classList.remove('is-active'));
  $$('.transcript-result-tab').forEach((button) => button.classList.toggle('is-active', button.dataset.transcriptModel === model));
  renderMainResult(source, model);
}

function closeResultView() {
  activeResultSourceId = null;
  activeResultModel = null;
  contentArea?.classList.remove('is-transcript-view');
  if (resultView) resultView.hidden = true;
  $$('.transcript-result-tab').forEach((button) => button.classList.remove('is-active'));
}

function renderResultTabs(source) {
  if (!transcriptTabs) return;
  transcriptTabs.innerHTML = '';
  if (!source || source.platform !== 'youtube') return;
  const results = resultsFor(source);
  for (const info of MODELS) {
    if (!results[info.id]) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'transcript-result-tab';
    button.dataset.transcriptModel = info.id;
    button.textContent = info.tabLabel;
    button.title = `Show recognized text from Whisper ${info.label}`;
    button.classList.toggle('is-active', activeResultSourceId === source.id && activeResultModel === info.id);
    button.addEventListener('click', () => showResultView(store.getSource(source.id), info.id));
    transcriptTabs.appendChild(button);
  }
}

function buttonLabel(source, model) {
  const job = getJob(source, model);
  const result = getResult(source, model);
  if (job?.status === 'queued') return `${model} · queued`;
  if (job?.status === 'running') {
    const progress = Number(job.progress);
    return Number.isFinite(progress) ? `${model} · ${Math.round(progress)}%` : `${model} · running`;
  }
  if (job?.status === 'error') return `Retry ${model}`;
  return result ? `Redo ${model}` : `Recognize ${model}`;
}

function syncHeader() {
  const source = currentSource();
  const isYouTube = source?.platform === 'youtube';
  recognizeGroup.hidden = !isYouTube;

  if (!isYouTube) {
    renderResultTabs(null);
    if (activeResultModel) closeResultView();
    lastCurrentSourceId = null;
    return;
  }

  if (lastCurrentSourceId && lastCurrentSourceId !== source.id && activeResultModel) closeResultView();
  lastCurrentSourceId = source.id;

  $$('[data-recognize-model]').forEach((button) => {
    const model = button.dataset.recognizeModel;
    const job = getJob(source, model);
    const result = getResult(source, model);
    button.textContent = buttonLabel(source, model);
    button.classList.toggle('is-running', isJobActive(job));
    button.classList.toggle('is-done', Boolean(result) && !isJobActive(job));
    button.classList.toggle('is-error', job?.status === 'error');
  });

  renderResultTabs(source);
  if (activeResultSourceId === source.id && activeResultModel && getResult(source, activeResultModel)) {
    showResultView(source, activeResultModel);
  }
  if (dialog?.open && activeDialogSourceId === source.id) renderDialog(source, activeDialogModel);
}

function jobFromServer(job) {
  return {
    id: job.id,
    model: job.model,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    phaseProgress: job.phaseProgress,
    message: job.message || '',
    heartbeatAt: job.heartbeatAt || job.updatedAt || null,
    lastProgressAt: job.lastProgressAt || null,
    error: job.error || null,
    createdAt: job.createdAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
  };
}

function saveCompletedResult(sourceId, model, data, job) {
  const result = {
    ...data,
    method: 'whisper',
    model,
    generated: true,
    startedAt: job?.startedAt || null,
    finishedAt: job?.finishedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  setModelResult(sourceId, model, result);
  setModelJob(sourceId, model, null);
  syncHeader();
  if (dialog?.open && activeDialogSourceId === sourceId && activeDialogModel === model) {
    renderDialog(store.getSource(sourceId), model);
  }
  if (activeResultSourceId === sourceId && activeResultModel === model) renderMainResult(store.getSource(sourceId), model);
}

function markJobError(sourceId, model, message) {
  const current = getJob(store.getSource(sourceId), model) || {};
  setModelJob(sourceId, model, {
    ...current,
    status: 'error',
    phase: 'error',
    message,
    error: message,
    heartbeatAt: new Date().toISOString(),
  });
  syncHeader();
  if (dialog?.open && activeDialogSourceId === sourceId && activeDialogModel === model) {
    renderDialog(store.getSource(sourceId), model);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollLocalJob(sourceId, model) {
  const key = `${sourceId}::${model}`;
  if (pollingKeys.has(key)) return;
  pollingKeys.add(key);

  try {
    while (true) {
      const source = store.getSource(sourceId);
      const localJob = getJob(source, model);
      if (!localJob?.id || !isJobActive(localJob)) return;
      const jobId = localJob.id;

      let job;
      try {
        job = await getLocalWhisperJob(jobId);
      } catch (error) {
        const message = error.status === 404
          ? 'The local Whisper service lost this task. It was probably restarted; run this model again.'
          : `Could not check recognition state: ${error.message || error}`;
        markJobError(sourceId, model, message);
        return;
      }

      const latest = store.getSource(sourceId);
      const latestJob = getJob(latest, model);
      if (!latest || latestJob?.id !== jobId) return;
      setModelJob(sourceId, model, jobFromServer(job));

      if (job.status === 'done') {
        if (!job.result?.ok) {
          markJobError(sourceId, model, 'Recognition finished without a usable result.');
          return;
        }
        saveCompletedResult(sourceId, model, job.result, job);
        return;
      }
      if (job.status === 'error') {
        markJobError(sourceId, model, job.error || job.message || 'Local Whisper recognition failed.');
        return;
      }

      syncHeader();
      await delay(document.visibilityState === 'visible' ? 1000 : 3000);
    }
  } finally {
    pollingKeys.delete(key);
  }
}

async function startRecognition(source, model) {
  if (!source || source.platform !== 'youtube' || !MODEL_IDS.has(model)) return;
  const existing = getJob(source, model);
  if (isJobActive(existing)) {
    openTranscriptDialog(source, model);
    return;
  }

  setModelJob(source.id, model, {
    id: null,
    model,
    status: 'queued',
    phase: 'starting',
    progress: 0,
    phaseProgress: 0,
    message: `Checking local Whisper before starting ${model}…`,
    heartbeatAt: new Date().toISOString(),
    lastProgressAt: new Date().toISOString(),
    error: null,
  });
  syncHeader();
  openTranscriptDialog(store.getSource(source.id), model);

  try {
    const status = await checkLocalWhisper({ quiet: true });
    if (!status.online) throw new Error('Local Whisper is offline. Start J:\\dv\\cc\\start-whisper.cmd first.');
    const supported = Array.isArray(status.supportedModels) ? status.supportedModels : [];
    if (!supported.includes(model)) {
      throw new Error('The running Whisper service is an older version. Pull the repository and restart start-whisper.cmd to enable small / medium / large-v3 selection.');
    }

    const job = await createLocalWhisperJob(source.url, null, model);
    setModelJob(source.id, model, jobFromServer(job));
    syncHeader();
    void pollLocalJob(source.id, model);
  } catch (error) {
    markJobError(source.id, model, error.message || 'Could not start local Whisper recognition.');
  }
}

function openTranscriptDialog(source, model) {
  if (!source || source.platform !== 'youtube') return;
  activeDialogSourceId = source.id;
  activeDialogModel = model;
  renderDialog(source, model);
  if (!dialog.open) dialog.showModal();
}

$$('[data-recognize-model]').forEach((button) => {
  button.addEventListener('click', () => {
    const source = currentSource();
    if (!source || source.platform !== 'youtube') return;
    const model = button.dataset.recognizeModel;
    const job = getJob(source, model);
    if (isJobActive(job)) openTranscriptDialog(source, model);
    else void startRecognition(source, model);
  });
});

dialogRun?.addEventListener('click', (event) => {
  event.preventDefault();
  const source = store.getSource(activeDialogSourceId) || currentSource();
  if (!source) return;
  const job = getJob(source, activeDialogModel);
  if (isJobActive(job)) return;
  void startRecognition(source, activeDialogModel);
});

dialogMinimize?.addEventListener('click', (event) => {
  event.preventDefault();
  if (dialog.open) dialog.close();
});

async function copyText(value, button) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const old = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = old; }, 1200);
  } catch {
    if (button === dialogCopy) {
      dialogOutput.focus();
      dialogOutput.select();
    } else {
      resultText.focus();
      resultText.select();
    }
  }
}

dialogCopy?.addEventListener('click', (event) => {
  event.preventDefault();
  void copyText(dialogOutput.value, dialogCopy);
});

resultCopy?.addEventListener('click', () => void copyText(resultText.value, resultCopy));

$$('#top-tabs .top-tab').forEach((button) => {
  button.addEventListener('click', () => closeResultView());
});

function resumeJobs() {
  for (const source of store.getSources()) {
    if (source.platform !== 'youtube') continue;
    for (const info of MODELS) {
      const job = getJob(source, info.id);
      if (job?.id && isJobActive(job)) void pollLocalJob(source.id, info.id);
    }
  }
  syncHeader();
}

migrateLegacyState();

if (sourcesList) {
  new MutationObserver(syncHeader).observe(sourcesList, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

document.addEventListener('click', () => setTimeout(syncHeader, 0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeJobs();
});

resumeJobs();
syncHeader();
