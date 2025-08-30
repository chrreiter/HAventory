param(
  [Parameter(Mandatory=$true)]
  [string]$ContainerName,
  [bool]$UseDevConfig = $true,
  [bool]$TailLogs = $true,
  [bool]$Clean = $true,
  [bool]$StartHA = $true,
  [int]$SleepSecondsAfterRestart = 8
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

  $targetRoot = '/workspaces/home-assistant_core/config/custom_components'

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
      $remoteCfgDir = '/workspaces/home-assistant_core/config'
      $remoteCfg    = "$remoteCfgDir/configuration.yaml"
      Write-Info 'Backing up existing configuration.yaml inside container (if present)...'
      docker exec $ContainerName sh -lc "mkdir -p '$remoteCfgDir'; if [ -f '$remoteCfg' ]; then cp -f '$remoteCfg' '$remoteCfg.bak'; fi" | Out-Null

      Write-Info 'Deploying dev/ha_config_for_dev.yaml to configuration.yaml...'
      docker cp $devConfig "$ContainerName`:$remoteCfgDir/configuration.yaml" | Out-Null
    } else {
      Write-Err "Dev config not found: $devConfig (skipping config copy)"
    }
  } else {
    $examplesConfig = Join-Path $repoRoot 'examples\configuration.yaml'
    if (Test-Path -Path $examplesConfig -PathType Leaf) {
      $remoteCfgDir = '/workspaces/home-assistant_core/config'
      $remoteCfg    = "$remoteCfgDir/configuration.yaml"
      Write-Info 'Backing up existing configuration.yaml inside container (if present)...'
      docker exec $ContainerName sh -lc "mkdir -p '$remoteCfgDir'; if [ -f '$remoteCfg' ]; then cp -f '$remoteCfg' '$remoteCfg.bak'; fi" | Out-Null

      Write-Info 'Deploying examples/configuration.yaml to configuration.yaml...'
      docker cp $examplesConfig "$ContainerName`:$remoteCfgDir/configuration.yaml" | Out-Null
    } else {
      Write-Err "Examples config not found: $examplesConfig (skipping config copy)"
    }
  }

  Write-Info "Restarting container '$ContainerName'..."
  docker restart $ContainerName | Out-Null
  Write-Host '  -> Restarted' -ForegroundColor Green

  if ($StartHA) {
    Write-Info 'Starting Home Assistant inside container (venv)...'
    $startCmd = ". /home/vscode/.local/ha-venv/bin/activate && cd /workspaces/home-assistant_core && nohup python -m homeassistant --config config >/workspaces/home-assistant_core/config/ha.out 2>&1 &"
    docker exec $ContainerName sh -lc $startCmd | Out-Null

    if ($SleepSecondsAfterRestart -gt 0) { Start-Sleep -Seconds $SleepSecondsAfterRestart }
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
