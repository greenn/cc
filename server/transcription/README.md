# CC Whisper transcription service

This service is the fallback used when a YouTube video has no normal or automatically generated caption track.

## Current local flow

1. CC asks the PHP backend for a YouTube caption track.
2. If captions exist, CC uses them immediately.
3. If captions do not exist, the browser calls the local service directly at `http://127.0.0.1:8787`.
4. `yt-dlp` downloads only the best available audio stream.
5. `faster-whisper` recognizes speech and returns text plus time-coded segments.

This means the Python service may run on the same Windows PC where the browser is open. The remote PHP hosting does not need direct access to your computer.

## Windows: easiest start

From the repository root run:

```bat
J:
cd \dv\cc
start-whisper.cmd
```

Or just double-click `start-whisper.cmd` in Explorer.

On the first run the script creates `server\transcription\.venv` and installs the Python packages automatically. Later starts reuse the same environment.

Keep the command window open while you want local Whisper recognition to be available.

Default local address:

```text
http://127.0.0.1:8787
```

CC Settings → Local transcription should use that same URL. The header indicator shows `Whisper online` when `/health` is reachable.

## Manual install

Python 3.11+ is recommended.

```bash
python -m venv .venv
```

Windows:

```bat
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Manual run

Windows CMD:

```bat
set CC_WHISPER_MODEL=small
set CC_WHISPER_DEVICE=cpu
set CC_WHISPER_COMPUTE_TYPE=int8
.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8787
```

Windows PowerShell:

```powershell
$env:CC_WHISPER_MODEL='small'
$env:CC_WHISPER_DEVICE='cpu'
$env:CC_WHISPER_COMPUTE_TYPE='int8'
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8787
```

## Optional token

For a local loopback-only service the token can stay empty. If you want one:

```powershell
$env:CC_WHISPER_TOKEN='replace-with-a-secret'
```

Then enter the same value in CC Settings → `Local Whisper token`.

## Useful environment variables

- `CC_WHISPER_MODEL`: `small` by default. `large-v3` gives higher quality but needs much more RAM/VRAM.
- `CC_WHISPER_DEVICE`: `cpu` by default; use `cuda` on a compatible NVIDIA host.
- `CC_WHISPER_COMPUTE_TYPE`: `int8` by default for CPU.
- `CC_WHISPER_TOKEN`: optional bearer token protecting `/transcribe`.
- `CC_WHISPER_ALLOWED_ORIGINS`: comma-separated browser origins allowed by CORS. Defaults include `https://greenn.github.io` and local development origins.

## Browser permissions

Modern Chromium browsers can ask for permission when a public HTTPS page connects to a service on the local computer. Allow local network/loopback access for the CC page when prompted; otherwise the status will remain offline even while Python is running.

The Python service is not required for videos that already have usable YouTube captions.
