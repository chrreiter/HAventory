param(
  [Parameter(Mandatory=$true)]
  [string]$ContainerName,
  [bool]$UseDevConfig = $true,
  [bool]$TailLogs = $true,
  [bool]$Clean = $true,
  [bool]$StartHA = $true,
  [int]$SleepSecondsAfterRestart = 8,
  [bool]$InitConfigEntry = $true
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Err([string]$msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

try {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
  $repoRoot  = Split-Path -Parent $scriptDir

  $localComponentPath = Join-Path $repoRoot 'custom_components\haventory'
  if (-not (Test-Path -Path $localComponentPath -PathType Container)) {
    throw "Local component path not found: $localComponentPath"
  }

  $containers = docker ps -a --format '{{.Names}}'
  if ($containers -notcontains $ContainerName) {
    Write-Err "Container '$ContainerName' not found. Available: $containers. Specify a valid -ContainerName."
    exit 1
  }

  # Detect the correct Home Assistant config directory inside the container
  # Prefer /config (HA OS / supervised). Fallback to devcontainer path.
  $configDirProbe = docker exec $ContainerName sh -lc "if [ -d /config ]; then echo /config; elif [ -d /workspaces/home-assistant_core/config ]; then echo /workspaces/home-assistant_core/config; else echo /config; fi" 2>$null
  $remoteCfgDir = if ($configDirProbe) { $configDirProbe.Trim() } else { '/config' }
  $targetRoot = "$remoteCfgDir/custom_components"

  Write-Info 'Ensuring target directory exists inside container...'
  docker exec $ContainerName sh -lc "mkdir -p '$targetRoot'" | Out-Null

  if ($Clean) {
    Write-Info 'Cleaning __pycache__ folders...'
    $cleanupCmd = @(
      "find $targetRoot -type d -name __pycache__ -prune -exec rm -rf {} +"
    ) -join ' && '
    docker exec $ContainerName sh -lc "$cleanupCmd" | Out-Null
  }

  Write-Info 'Copying updated integration into container...'
  docker cp $localComponentPath "$ContainerName`:$targetRoot" | Out-Null
  Write-Host "  -> Copied to $targetRoot" -ForegroundColor Green

  if ($UseDevConfig) {
    $devConfig = Join-Path $repoRoot 'dev\ha_config_for_dev.yaml'
    if (Test-Path -Path $devConfig -PathType Leaf) {
      $remoteCfg    = "$remoteCfgDir/configuration.yaml"
      Write-Info 'Backing up existing configuration.yaml inside container (if present)...'
      docker exec $ContainerName sh -lc "mkdir -p '$remoteCfgDir'; if [ -f '$remoteCfg' ]; then cp -f '$remoteCfg' '$remoteCfg.bak'; fi" | Out-Null

      Write-Info "Deploying dev/ha_config_for_dev.yaml to $remoteCfg ..."
      docker cp $devConfig "$ContainerName`:$remoteCfgDir/configuration.yaml" | Out-Null
    } else {
      Write-Err "Dev config not found: $devConfig (skipping config copy)"
    }
  } else {
    $examplesConfig = Join-Path $repoRoot 'examples\configuration.yaml'
    if (Test-Path -Path $examplesConfig -PathType Leaf) {
      $remoteCfg    = "$remoteCfgDir/configuration.yaml"
      Write-Info 'Backing up existing configuration.yaml inside container (if present)...'
      docker exec $ContainerName sh -lc "mkdir -p '$remoteCfgDir'; if [ -f '$remoteCfg' ]; then cp -f '$remoteCfg' '$remoteCfg.bak'; fi" | Out-Null

      Write-Info "Deploying examples/configuration.yaml to $remoteCfg ..."
      docker cp $examplesConfig "$ContainerName`:$remoteCfgDir/configuration.yaml" | Out-Null
    } else {
      Write-Err "Examples config not found: $examplesConfig (skipping config copy)"
    }
  }

  Write-Info "Restarting container '$ContainerName'..."
  docker restart $ContainerName | Out-Null
  Write-Host '  -> Restarted' -ForegroundColor Green

  if ($StartHA) {
    # Start HA only in devcontainer setups where the dev venv exists; otherwise HA OS will manage it
    $checkDevPy = docker exec $ContainerName sh -lc "[ -x /home/vscode/.local/ha-venv/bin/python ] && echo yes || echo no" 2>$null
    if ($checkDevPy -and $checkDevPy.Trim() -eq 'yes') {
      Write-Info 'Starting Home Assistant inside container (dev venv)...'
      $startCmd = ". /home/vscode/.local/ha-venv/bin/activate && cd /workspaces/home-assistant_core && nohup python -m homeassistant --config config >/workspaces/home-assistant_core/config/ha.out 2>&1 &"
      docker exec $ContainerName sh -lc $startCmd | Out-Null
    } else {
      Write-Info 'Skipping manual HA start (managed by container supervisor).'
    }

    if ($SleepSecondsAfterRestart -gt 0) { Start-Sleep -Seconds $SleepSecondsAfterRestart }
  }

  # Optionally initialize the HAventory config entry via WebSocket API
  if ($InitConfigEntry) {
    if (-not $Env:HA_TOKEN -or -not $Env:HA_BASE_URL) {
      Write-Info 'Skipping HAventory config entry init (HA_TOKEN/HA_BASE_URL not set).'
    } else {
      # Give HA a brief extra moment before hitting WS
      Start-Sleep -Seconds 2
      $wsInitPath = Join-Path $repoRoot 'scripts\ws_init_haventory.py'
      $pythonCmd = $null
      if (Get-Command python -ErrorAction SilentlyContinue) { $pythonCmd = 'python' }
      elseif (Get-Command py -ErrorAction SilentlyContinue) { $pythonCmd = 'py -3.12' }
      if ($pythonCmd) {
        Write-Info 'Initializing HAventory config entry via WS...'
        $wsOk = $false
        try {
          & $pythonCmd $wsInitPath | Out-Host
          if ($LASTEXITCODE -eq 0) { $wsOk = $true }
        } catch {
          Write-Err "Failed to initialize HAventory via WS: $($_.Exception.Message)"
        }

        if (-not $wsOk) {
          Write-Info 'WS init failed; attempting REST config flow init...'
          try {
            $base = if ($Env:HA_BASE_URL) { $Env:HA_BASE_URL.TrimEnd('/') } else { 'http://localhost:8123' }
            $headers = @{ Authorization = "Bearer $($Env:HA_TOKEN)"; 'Content-Type' = 'application/json' }
            $body = @{ handler = 'haventory'; show_advanced_options = $false } | ConvertTo-Json -Compress
            $flow = Invoke-RestMethod -Headers $headers -Uri "$base/api/config/config_entries/flow" -Method Post -Body $body -TimeoutSec 15
            if ($flow.type -eq 'form' -and $flow.flow_id) {
              $fid = $flow.flow_id
              $cfgBody = @{ user_input = @{} } | ConvertTo-Json -Compress
              $res2 = Invoke-RestMethod -Headers $headers -Uri "$base/api/config/config_entries/flow/$fid" -Method Post -Body $cfgBody -TimeoutSec 15
              Write-Info "REST flow progressed: $($res2.type)"
            } elseif ($flow.type -eq 'abort') {
              Write-Info "REST flow abort: $($flow.reason)"
            } else {
              Write-Info 'REST flow created entry or returned unexpected shape.'
            }
            Start-Sleep -Seconds 2
          } catch {
            Write-Err "REST config flow init failed: $($_.Exception.Message)"
          }
        }
      } else {
        Write-Err 'Python not found on host; cannot run ws_init_haventory.py'
      }
    }
  }

  if ($TailLogs) {
    if ($SleepSecondsAfterRestart -gt 0) { Start-Sleep -Seconds $SleepSecondsAfterRestart }
    Write-Info 'Recent logs (filtered by integration id)...'
    docker logs $ContainerName --since 2m | Select-String -Pattern 'haventory'
  }

  Write-Info 'Done.'
}
catch {
  Write-Err $_.Exception.Message
  exit 1
}
