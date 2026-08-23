# CC Whisper transcription service

This service is the fallback used when a YouTube video has no normal or automatically generated caption track.

## Flow

1. `server/php/api/transcript.php` first tries YouTube captions.
2. If no caption track exists, the PHP backend calls this service.
3. `yt-dlp` downloads only the best available audio stream.
4. `faster-whisper` recognizes speech and returns text plus time-coded segments.

## Install

Python 3.11+ is recommended.

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
```

On Windows use `.venv\\Scripts\\pip.exe` instead.

## Run

```bash
export CC_WHISPER_TOKEN='replace-with-a-secret'
export CC_WHISPER_MODEL='small'
uvicorn app:app --host 127.0.0.1 --port 8787
```

Windows PowerShell:

```powershell
$env:CC_WHISPER_TOKEN='replace-with-a-secret'
$env:CC_WHISPER_MODEL='small'
uvicorn app:app --host 127.0.0.1 --port 8787
```

Then set the same service in `server/php/config.php`:

```php
'whisper_service_url' => 'http://127.0.0.1:8787',
'whisper_service_token' => 'replace-with-a-secret',
```

Useful environment variables:

- `CC_WHISPER_MODEL`: `small` by default. `large-v3` gives higher quality but needs much more RAM/VRAM.
- `CC_WHISPER_DEVICE`: `cpu` by default; use `cuda` on a compatible NVIDIA host.
- `CC_WHISPER_COMPUTE_TYPE`: `int8` by default for CPU.
- `CC_WHISPER_TOKEN`: optional bearer token protecting `/transcribe`.

The Python service is not required for videos that already have YouTube captions.
