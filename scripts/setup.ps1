param(
  [switch]$CI
)

$ErrorActionPreference = 'Stop'

function Invoke-Python {
  param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Args
  )
  if (Get-Command python -ErrorAction SilentlyContinue) {
    & python @Args
    return
  }
  if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3.12 @Args
    return
  }
  throw 'Python 3.12 not found (expected "python" or "py -3.12").'
}

Write-Host 'Creating venv...' -ForegroundColor Cyan
Invoke-Python -Args @('-m','venv','.venv')

Write-Host 'Activating venv and installing dependencies...' -ForegroundColor Cyan
. .\.venv\Scripts\Activate.ps1
Invoke-Python -Args @('-m','pip','install','-U','pip')
if (Test-Path 'requirements-dev.txt') {
  pip install -r requirements-dev.txt
} else {
  pip install pytest pytest-asyncio aioresponses tzdata "beautifulsoup4==4.12.3" "aiohttp>=3.9.1" ruff pytest-cov pre-commit
}

if (-not $CI) {
  if ((Test-Path '.pre-commit-config.yaml') -and (Test-Path '.git')) {
    Write-Host 'Installing pre-commit hooks...' -ForegroundColor Cyan
    pre-commit install
  }
}

Write-Host 'Done.' -ForegroundColor Green
