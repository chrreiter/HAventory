$ErrorActionPreference = 'Stop'
. .\.venv\Scripts\Activate.ps1
ruff check --no-cache .
if (Test-Path 'cards/haventory-card') {
  Push-Location 'cards/haventory-card'
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    npx eslint .
  }
  Pop-Location
}
Write-Host 'Lint OK' -ForegroundColor Green
