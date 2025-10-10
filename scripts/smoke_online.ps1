$ErrorActionPreference = 'Stop'

function Invoke-PythonCmd {
  if (Get-Command python -ErrorAction SilentlyContinue) { return 'python' }
  if (Get-Command py -ErrorAction SilentlyContinue) { return 'py -3.12' }
  throw 'Python 3.12 not found (expected "python" or "py -3.12").'
}

# Activate venv if present
if (Test-Path '.\.venv\Scripts\Activate.ps1') { . .\.venv\Scripts\Activate.ps1 }

if (-not $Env:RUN_ONLINE) {
  Write-Host 'RUN_ONLINE is not set; skipping online smoke tests.' -ForegroundColor Yellow
  exit 0
}

if (-not $Env:HA_BASE_URL) { $Env:HA_BASE_URL = 'http://localhost:8123' }
if (-not $Env:HA_TOKEN) {
  Write-Host 'HA_TOKEN is not set. Please export a Home Assistant long-lived token.' -ForegroundColor Red
  exit 2
}

# If a container name is provided, purge HAventory storage for a clean start and reload
if ($Env:HA_CONTAINER) {
  Write-Host "Purging HAventory storage in container '$($Env:HA_CONTAINER)'..." -ForegroundColor Cyan
  try {
    docker exec $Env:HA_CONTAINER sh -lc "rm -f /config/.storage/haventory_store || true; rm -f /workspaces/home-assistant_core/config/.storage/haventory_store || true" | Out-Null
  } catch {
    Write-Host "Warning: failed to purge storage via docker exec: $($_.Exception.Message)" -ForegroundColor Yellow
  }

  # Reload integration and ensure config entry init
  try {
    & .\scripts\reload_addon.ps1 -ContainerName $Env:HA_CONTAINER -UseDevConfig:$true -TailLogs:$false -Clean:$true -StartHA:$true -SleepSecondsAfterRestart 8 -InitConfigEntry:$true | Out-Null
  } catch {
    Write-Host "Warning: reload_addon.ps1 failed: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

# Avoid 3rd-party pytest plugin interference
$Env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'

# Run core and advanced online smoke tests explicitly via module to avoid shim issues
$py = Invoke-PythonCmd
& $py -m pytest -q -m online --disable-warnings --maxfail=1 `
  tests\test_ws_smoke_online.py `
  tests\test_ws_smoke_advanced_online.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Online smoke test completed successfully.' -ForegroundColor Green
