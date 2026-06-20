# Запуск прототипа Stellar Drift.
# ES-модули требуют HTTP (file:// заблокирован CORS), поэтому поднимаем статик-сервер.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

# ── Бэкенд FastAPI (порт 8000) ───────────────────────────────────────────────
$backendPath = Join-Path $here '..\server'
$uvicorn     = Join-Path $backendPath 'venv\Scripts\python.exe'
Write-Host "Backend API  → http://localhost:8000" -ForegroundColor DarkCyan
Start-Process -FilePath $uvicorn `
  -ArgumentList '-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000' `
  -WorkingDirectory $backendPath `
  -WindowStyle Minimized

# ── Статик-сервер (порт 8080) ────────────────────────────────────────────────
$port = 8080
Write-Host "Stellar Drift → http://localhost:$port (no-cache)" -ForegroundColor Cyan
Start-Process "http://localhost:$port"
python server.py $port   # отдача без кэша — правки .js/.json всегда свежие
