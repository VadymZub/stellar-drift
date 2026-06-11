# Синхронизация ассетов из validation-репо в игровой client/assets.
# Запускай после того, как обновил ассет в C:\Work\space-mmo-validation\assets\.
# Игра грузит ИМЕННО client/assets — там источник правды для прототипа.
$ErrorActionPreference = 'Stop'
$src = 'C:\Work\space-mmo-validation\assets'
$dst = Split-Path -Parent $MyInvocation.MyCommand.Path | Join-Path -ChildPath 'assets'

$files = @(
  'ships\wisp.png',
  'mobs\m01_striker.png', 'mobs\m02_scout.png', 'mobs\m06_interceptor.png', 'mobs\m09_elite_fighter.png',
  'ui\arrow_waypoint.png', 'ui\arrow_cruise.png', 'ui\arrow_boost.png'
)

foreach ($f in $files) {
  $s = Join-Path $src $f
  $d = Join-Path $dst $f
  if (Test-Path $s) {
    if (-not (Test-Path $d) -or (Get-Item $s).LastWriteTime -gt (Get-Item $d).LastWriteTime) {
      Copy-Item $s $d -Force
      Write-Host "обновлён: $f" -ForegroundColor Green
    }
  } else {
    Write-Host "нет в источнике: $f" -ForegroundColor Yellow
  }
}
Write-Host "Готово. В браузере — Ctrl+F5." -ForegroundColor Cyan
