$ErrorActionPreference = 'Stop'
. .\.venv\Scripts\Activate.ps1
$Env:RUN_ONLINE='1'
$Env:HA_ALLOW_AREA_MUTATIONS='1'
pytest -q -m online
Write-Host 'Online tests OK' -ForegroundColor Green
