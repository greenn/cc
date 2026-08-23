import os
import tempfile
import threading
import time
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Callable, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from faster_whisper import WhisperModel
from yt_dlp import YoutubeDL

app = FastAPI(title="CC Whisper service", version="0.3.0")

DEFAULT_ALLOWED_ORIGINS = [
    "https://greenn.github.io",
    "https://backend83.nadube.ru",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
allowed_origins = [
    value.strip()
    for value in os.getenv("CC_WHISPER_ALLOWED_ORIGINS", ",".join(DEFAULT_ALLOWED_ORIGINS)).split(",")
    if value.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)


@app.middleware("http")
async def local_network_headers(request: Request, call_next):
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network", "").lower() == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


class TranscribeRequest(BaseModel):
    url: HttpUrl
    language: Optional[str] = None


JobProgress = Callable[[str, float, float, str], None]
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.RLock()
MAX_CONCURRENT_JOBS = max(1, int(os.getenv("CC_WHISPER_MAX_CONCURRENT_JOBS", "1")))
JOB_SLOTS = threading.Semaphore(MAX_CONCURRENT_JOBS)
JOB_RETENTION_SECONDS = max(3600, int(os.getenv("CC_WHISPER_JOB_RETENTION_SECONDS", "86400")))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_token(authorization: Optional[str]) -> None:
    expected = os.getenv("CC_WHISPER_TOKEN", "").strip()
    if not expected:
        return
    supplied = (authorization or "").strip()
    if supplied != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def normalize_language(value: Optional[str]) -> Optional[str]:
    language = (value or "").strip().lower() or None
    if language in {"auto", "any", "none"}:
        return None
    return language


def cleanup_jobs() -> None:
    cutoff = time.time() - JOB_RETENTION_SECONDS
    with JOBS_LOCK:
        removable = []
        for job_id, job in JOBS.items():
            if job.get("status") not in {"done", "error"}:
                continue
            finished_ts = float(job.get("finishedTs") or 0)
            if finished_ts and finished_ts < cutoff:
                removable.append(job_id)
        for job_id in removable:
            JOBS.pop(job_id, None)


def job_snapshot(job_id: str) -> dict:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Transcription job not found. The local Whisper service may have been restarted.")
        snapshot = deepcopy(job)
    snapshot.pop("finishedTs", None)
    return snapshot


def update_job(job_id: str, **patch) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return

        old_progress = float(job.get("progress") or 0)
        old_phase = job.get("phase")
        new_progress = patch.get("progress", old_progress)
        new_phase = patch.get("phase", old_phase)
        measurable_change = (
            new_phase != old_phase
            or float(new_progress or 0) > old_progress + 0.05
        )

        if "progress" in patch:
            patch["progress"] = round(max(0.0, min(100.0, float(patch["progress"]))), 1)
        if "phaseProgress" in patch:
            patch["phaseProgress"] = round(max(0.0, min(100.0, float(patch["phaseProgress"]))), 1)

        job.update(patch)
        job["updatedAt"] = now_iso()
        if measurable_change:
            job["lastProgressAt"] = job["updatedAt"]


def heartbeat_loop(job_id: str, stop_event: threading.Event) -> None:
    while not stop_event.wait(5):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if not job or job.get("status") in {"done", "error"}:
                return
            job["heartbeatAt"] = now_iso()
            job["updatedAt"] = job["heartbeatAt"]


@lru_cache(maxsize=1)
def whisper_model() -> WhisperModel:
    return WhisperModel(
        os.getenv("CC_WHISPER_MODEL", "small"),
        device=os.getenv("CC_WHISPER_DEVICE", "cpu"),
        compute_type=os.getenv("CC_WHISPER_COMPUTE_TYPE", "int8"),
    )


def human_bytes_per_second(value: object) -> str:
    try:
        speed = float(value or 0)
    except (TypeError, ValueError):
        return ""
    if speed <= 0:
        return ""
    units = ["B/s", "KB/s", "MB/s", "GB/s"]
    unit = 0
    while speed >= 1024 and unit < len(units) - 1:
        speed /= 1024
        unit += 1
    return f"{speed:.1f} {units[unit]}"


def download_audio(url: str, directory: Path, progress: Optional[JobProgress] = None) -> tuple[Path, float]:
    template = str(directory / "audio.%(ext)s")
    last_error: Optional[Exception] = None

    for attempt in range(1, 3):
        if progress:
            progress("preparing_audio", 2.0, 0.0, "Reading YouTube audio information…")

        def hook(data: dict) -> None:
            if not progress:
                return
            status = data.get("status")
            if status == "downloading":
                downloaded = float(data.get("downloaded_bytes") or 0)
                total = float(data.get("total_bytes") or data.get("total_bytes_estimate") or 0)
                phase_percent = (downloaded / total * 100.0) if total > 0 else 0.0
                overall = 5.0 + phase_percent * 0.25 if total > 0 else 7.0
                speed = human_bytes_per_second(data.get("speed"))
                eta = data.get("eta")
                extras = []
                if speed:
                    extras.append(speed)
                if eta is not None:
                    extras.append(f"ETA {int(eta)}s")
                suffix = f" · {' · '.join(extras)}" if extras else ""
                percent_label = f" {phase_percent:.0f}%" if total > 0 else ""
                progress("downloading_audio", overall, phase_percent, f"Downloading audio{percent_label}{suffix}")
            elif status == "finished":
                progress("downloading_audio", 30.0, 100.0, "Audio downloaded. Preparing Whisper…")

        options = {
            "format": "bestaudio/best",
            "outtmpl": template,
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "restrictfilenames": True,
            "retries": 5,
            "fragment_retries": 5,
            "extractor_retries": 3,
            "socket_timeout": 30,
            "progress_hooks": [hook],
        }

        try:
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(url, download=True)
                duration = float(info.get("duration") or 0)
                requested = info.get("requested_downloads") or []
                if requested and requested[0].get("filepath"):
                    path = Path(requested[0]["filepath"])
                    if path.exists():
                        return path, duration
                prepared = Path(ydl.prepare_filename(info))
                if prepared.exists():
                    return prepared, duration

            matches = list(directory.glob("audio.*"))
            if matches:
                return matches[0], duration
            raise RuntimeError("yt-dlp did not produce an audio file")
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                if progress:
                    progress("download_retry", 3.0, 0.0, "Audio download failed. Retrying once…")
                time.sleep(2)

    raise RuntimeError(f"Could not download YouTube audio after retry: {last_error}")


def transcribe_payload(payload: TranscribeRequest, progress: Optional[JobProgress] = None) -> dict:
    language = normalize_language(payload.language)

    with tempfile.TemporaryDirectory(prefix="cc-whisper-") as tmp:
        audio_path, detected_duration = download_audio(str(payload.url), Path(tmp), progress)

        if progress:
            progress(
                "loading_model",
                34.0,
                0.0,
                "Loading Whisper model. On the first run the model may still be downloading…",
            )
        model = whisper_model()

        if progress:
            progress("transcribing", 40.0, 0.0, "Whisper is recognizing speech…")

        segments_iter, info = model.transcribe(
            str(audio_path),
            language=language,
            vad_filter=True,
            beam_size=5,
        )

        duration = float(getattr(info, "duration", 0) or detected_duration or 0)
        segments = []
        text_parts = []
        last_reported = 40.0
        last_report_time = 0.0

        for segment in segments_iter:
            text = segment.text.strip()
            if not text:
                continue
            segment_end = float(segment.end)
            segments.append({
                "start": round(float(segment.start), 3),
                "duration": round(float(segment.end - segment.start), 3),
                "text": text,
            })
            text_parts.append(text)

            if progress:
                if duration > 0:
                    phase_percent = min(99.0, segment_end / duration * 100.0)
                    overall = min(99.0, 40.0 + phase_percent * 0.59)
                else:
                    phase_percent = 0.0
                    overall = min(95.0, 40.0 + len(segments) * 0.4)

                current_time = time.time()
                if overall >= last_reported + 0.5 or current_time - last_report_time >= 1.5:
                    progress(
                        "transcribing",
                        overall,
                        phase_percent,
                        f"Recognizing speech · {len(segments)} segments · {segment_end:.0f}s processed",
                    )
                    last_reported = overall
                    last_report_time = current_time

        return {
            "ok": True,
            "method": "whisper",
            "language": info.language or language or "",
            "languageProbability": round(float(info.language_probability or 0), 4),
            "text": "\n".join(text_parts),
            "segments": segments,
        }


def run_job(job_id: str, payload: TranscribeRequest) -> None:
    stop_heartbeat = threading.Event()
    heartbeat = threading.Thread(
        target=heartbeat_loop,
        args=(job_id, stop_heartbeat),
        daemon=True,
        name=f"cc-whisper-heartbeat-{job_id[:8]}",
    )
    heartbeat.start()

    try:
        update_job(
            job_id,
            status="queued",
            phase="queued",
            progress=0.0,
            phaseProgress=0.0,
            message="Waiting for the local Whisper worker…",
        )

        with JOB_SLOTS:
            update_job(
                job_id,
                status="running",
                phase="starting",
                progress=1.0,
                phaseProgress=0.0,
                message="Local Whisper worker started.",
                startedAt=now_iso(),
            )

            def report(phase: str, overall: float, phase_percent: float, message: str) -> None:
                update_job(
                    job_id,
                    status="running",
                    phase=phase,
                    progress=overall,
                    phaseProgress=phase_percent,
                    message=message,
                    heartbeatAt=now_iso(),
                )

            result = transcribe_payload(payload, report)
            update_job(
                job_id,
                status="done",
                phase="done",
                progress=100.0,
                phaseProgress=100.0,
                message="Recognition finished.",
                result=result,
                finishedAt=now_iso(),
                heartbeatAt=now_iso(),
            )
            with JOBS_LOCK:
                if job_id in JOBS:
                    JOBS[job_id]["finishedTs"] = time.time()
    except Exception as exc:
        update_job(
            job_id,
            status="error",
            phase="error",
            message=f"Transcription failed: {exc}",
            error=str(exc),
            finishedAt=now_iso(),
            heartbeatAt=now_iso(),
        )
        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]["finishedTs"] = time.time()
    finally:
        stop_heartbeat.set()


@app.get("/health")
def health() -> dict:
    with JOBS_LOCK:
        active_jobs = sum(1 for job in JOBS.values() if job.get("status") == "running")
        queued_jobs = sum(1 for job in JOBS.values() if job.get("status") == "queued")
    return {
        "ok": True,
        "version": "0.3.0",
        "model": os.getenv("CC_WHISPER_MODEL", "small"),
        "device": os.getenv("CC_WHISPER_DEVICE", "cpu"),
        "computeType": os.getenv("CC_WHISPER_COMPUTE_TYPE", "int8"),
        "modelLoaded": whisper_model.cache_info().currsize > 0,
        "activeJobs": active_jobs,
        "queuedJobs": queued_jobs,
        "maxConcurrentJobs": MAX_CONCURRENT_JOBS,
    }


@app.post("/jobs")
def create_job(payload: TranscribeRequest, authorization: Optional[str] = Header(default=None)) -> dict:
    require_token(authorization)
    cleanup_jobs()
    job_id = uuid.uuid4().hex
    created_at = now_iso()
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "status": "queued",
            "phase": "queued",
            "progress": 0.0,
            "phaseProgress": 0.0,
            "message": "Queued for local recognition.",
            "createdAt": created_at,
            "updatedAt": created_at,
            "heartbeatAt": created_at,
            "lastProgressAt": created_at,
            "startedAt": None,
            "finishedAt": None,
            "error": None,
            "result": None,
        }

    worker = threading.Thread(
        target=run_job,
        args=(job_id, payload),
        daemon=True,
        name=f"cc-whisper-job-{job_id[:8]}",
    )
    worker.start()
    return {"ok": True, "job": job_snapshot(job_id)}


@app.get("/jobs/{job_id}")
def get_job(job_id: str, authorization: Optional[str] = Header(default=None)) -> dict:
    require_token(authorization)
    return {"ok": True, "job": job_snapshot(job_id)}


@app.post("/transcribe")
def transcribe(payload: TranscribeRequest, authorization: Optional[str] = Header(default=None)) -> dict:
    """Backward-compatible synchronous endpoint for older CC clients."""
    require_token(authorization)
    try:
        return transcribe_payload(payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc
