Set-Location $PSScriptRoot

# Создать venv если не существует
if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv venv
}

# Активировать venv
. .\venv\Scripts\Activate.ps1

# Установить зависимости
pip install -r requirements.txt --quiet

# Запустить сервер
Write-Host "Starting Stellar Drift API on http://localhost:8000"
Write-Host "Docs: http://localhost:8000/docs"
uvicorn main:app --reload --host 0.0.0.0 --port 8000
