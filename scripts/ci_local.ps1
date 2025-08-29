$ErrorActionPreference = 'Stop'

# Activate venv
. .\.venv\Scripts\Activate.ps1

Write-Host 'Running backend lint...' -ForegroundColor Cyan
ruff check --no-cache .

Write-Host 'Running backend offline tests...' -ForegroundColor Cyan
$Env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
pytest -q
Remove-Item Env:\PYTEST_DISABLE_PLUGIN_AUTOLOAD -ErrorAction SilentlyContinue

if (Test-Path 'cards/haventory-card') {
  Push-Location 'cards/haventory-card'
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host 'Frontend: install, lint, test, build' -ForegroundColor Cyan
    npm ci
    npm run lint
    npm test
    npm run build
  } else {
    Write-Warning 'npm not found; skipping frontend tasks.'
  }
  Pop-Location
}

Write-Host 'Local CI completed.' -ForegroundColor Green
