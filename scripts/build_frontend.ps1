$ErrorActionPreference = 'Stop'
Push-Location 'cards/haventory-card'
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Warning 'npm is not available on PATH; skipping frontend build.'
  Pop-Location
  exit 0
}
npm ci
npm run build
Pop-Location
Write-Host 'Frontend build complete.' -ForegroundColor Green
