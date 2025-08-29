$ErrorActionPreference = 'Stop'
. .\.venv\Scripts\Activate.ps1
$Env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
pytest -q
Write-Host 'Tests OK' -ForegroundColor Green
