$ErrorActionPreference = 'Stop'

# Activate venv
. .\.venv\Scripts\Activate.ps1

Write-Host 'Running backend lint...' -ForegroundColor Cyan
ruff check --no-cache .

Write-Host 'Running backend offline tests...' -ForegroundColor Cyan
$Env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
pytest -q -p pytest_cov --cov=custom_components/haventory --cov-report=term-missing:skip-covered --cov-report=xml --cov-report=html --junitxml=junit.xml
if (Test-Path 'coverage.xml') {
  try {
    [xml]$c = Get-Content coverage.xml
    $rate = [math]::Round(100 * [double]$c.coverage.'line-rate', 2)
    Write-Host ("Backend coverage: {0}% (HTML: htmlcov/index.html)" -f $rate) -ForegroundColor Green
  } catch {
    Write-Warning 'Could not parse coverage.xml for summary.'
  }
}
Remove-Item Env:\PYTEST_DISABLE_PLUGIN_AUTOLOAD -ErrorAction SilentlyContinue

if (Test-Path 'cards/haventory-card') {
  Push-Location 'cards/haventory-card'
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host 'Frontend: install, lint, test, build' -ForegroundColor Cyan
    npm ci
    npm run lint
    npm test -- --coverage
    npm run build
  } else {
    Write-Warning 'npm not found; skipping frontend tasks.'
  }
  Pop-Location
}

Write-Host 'Local CI completed.' -ForegroundColor Green
