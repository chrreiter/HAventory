$ErrorActionPreference = 'Stop'
Push-Location 'cards/haventory-card'
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Warning 'npm is not available on PATH; skipping frontend build.'
  Pop-Location
  exit 0
}
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
  Write-Error "npm ci failed with exit code $LASTEXITCODE. Your package-lock.json is likely out of sync. Run 'npm install' in 'cards/haventory-card' to update the lock file."
  Pop-Location
  exit $LASTEXITCODE
}
Write-Host 'ci: OK'

npm run -s build
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  exit $LASTEXITCODE
}
Pop-Location
Write-Host 'Frontend build complete.' -ForegroundColor Green
