@echo off
setlocal
cd /d "%~dp0server\transcription"

if not exist ".venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  python -m venv .venv
  if errorlevel 1 goto :error

  echo Installing CC Whisper dependencies...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  if errorlevel 1 goto :error
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 goto :error
)

if "%CC_WHISPER_MODEL%"=="" set CC_WHISPER_MODEL=small
if "%CC_WHISPER_DEVICE%"=="" set CC_WHISPER_DEVICE=cpu
if "%CC_WHISPER_COMPUTE_TYPE%"=="" set CC_WHISPER_COMPUTE_TYPE=int8

 echo.
 echo CC Whisper starting at http://127.0.0.1:8787
 echo Model: %CC_WHISPER_MODEL%  Device: %CC_WHISPER_DEVICE%  Compute: %CC_WHISPER_COMPUTE_TYPE%
 echo Keep this window open while using local transcription in CC.
 echo.

".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8787
if errorlevel 1 goto :error
exit /b 0

:error
 echo.
 echo Could not start CC Whisper. See the error above.
 pause
 exit /b 1
