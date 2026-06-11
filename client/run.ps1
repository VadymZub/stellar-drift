# Запуск прототипа Stellar Drift.
# ES-модули требуют HTTP (file:// заблокирован CORS), поэтому поднимаем статик-сервер.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$port = 8080
Write-Host "Stellar Drift → http://localhost:$port (no-cache)" -ForegroundColor Cyan
Start-Process "http://localhost:$port"
python server.py $port   # отдача без кэша — правки .js/.json всегда свежие
