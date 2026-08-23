import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, HttpUrl
from faster_whisper import WhisperModel
from yt_dlp import YoutubeDL

app = FastAPI(title="CC Whisper service", version="0.1.0")


class TranscribeRequest(BaseModel):
    url: HttpUrl
    language: Optional[str] = None


def require_token(authorization: Optional[str]) -> None:
    expected = os.getenv("CC_WHISPER_TOKEN", "").strip()
    if not expected:
        return
    supplied = (authorization or "").strip()
    if supplied != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@lru_cache(maxsize=1)
def whisper_model() -> WhisperModel:
    return WhisperModel(
        os.getenv("CC_WHISPER_MODEL", "small"),
        device=os.getenv("CC_WHISPER_DEVICE", "cpu"),
        compute_type=os.getenv("CC_WHISPER_COMPUTE_TYPE", "int8"),
    )


def download_audio(url: str, directory: Path) -> Path:
    template = str(directory / "audio.%(ext)s")
    options = {
        "format": "bestaudio/best",
        "outtmpl": template,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "restrictfilenames": True,
    }
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        requested = info.get("requested_downloads") or []
        if requested and requested[0].get("filepath"):
            return Path(requested[0]["filepath"])
        prepared = Path(ydl.prepare_filename(info))
        if prepared.exists():
            return prepared

    matches = list(directory.glob("audio.*"))
    if not matches:
        raise RuntimeError("yt-dlp did not produce an audio file")
    return matches[0]


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "model": os.getenv("CC_WHISPER_MODEL", "small"),
        "device": os.getenv("CC_WHISPER_DEVICE", "cpu"),
    }


@app.post("/transcribe")
def transcribe(payload: TranscribeRequest, authorization: Optional[str] = Header(default=None)) -> dict:
    require_token(authorization)
    language = (payload.language or "").strip().lower() or None
    if language in {"auto", "any", "none"}:
        language = None

    try:
        with tempfile.TemporaryDirectory(prefix="cc-whisper-") as tmp:
            audio_path = download_audio(str(payload.url), Path(tmp))
            segments_iter, info = whisper_model().transcribe(
                str(audio_path),
                language=language,
                vad_filter=True,
                beam_size=5,
            )
            segments = []
            text_parts = []
            for segment in segments_iter:
                text = segment.text.strip()
                if not text:
                    continue
                segments.append({
                    "start": round(float(segment.start), 3),
                    "duration": round(float(segment.end - segment.start), 3),
                    "text": text,
                })
                text_parts.append(text)

            return {
                "ok": True,
                "method": "whisper",
                "language": info.language or language or "",
                "languageProbability": round(float(info.language_probability or 0), 4),
                "text": "\n".join(text_parts),
                "segments": segments,
            }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc
