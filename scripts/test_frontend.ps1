<#
.SYNOPSIS
    Run frontend tests (Vitest) for the HAventory card.

.DESCRIPTION
    Executes the test suite for cards/haventory-card using Vitest.
    Supports coverage reporting and watch mode.

.PARAMETER Coverage
    Generate coverage report. Opens coverage/index.html when complete.

.PARAMETER Watch
    Run tests in watch mode (interactive).

.EXAMPLE
    .\scripts\test_frontend.ps1
    Run tests once and exit.

.EXAMPLE
    .\scripts\test_frontend.ps1 -Coverage
    Run tests with coverage report.

.EXAMPLE
    .\scripts\test_frontend.ps1 -Watch
    Run tests in watch mode.
#>

param(
    [switch]$Coverage,
    [switch]$Watch
)

$ErrorActionPreference = 'Stop'

# Check if npm is available
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error 'npm is not available on PATH. Install Node.js 20+ and ensure npm is in your PATH.'
    exit 1
}

# Check if frontend directory exists
if (-not (Test-Path 'cards/haventory-card')) {
    Write-Error 'Frontend directory not found: cards/haventory-card'
    exit 1
}

Push-Location 'cards/haventory-card'

try {
    # Ensure dependencies are installed
    if (-not (Test-Path 'node_modules')) {
        Write-Host 'Installing dependencies...' -ForegroundColor Cyan
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm ci failed with exit code $LASTEXITCODE"
            exit $LASTEXITCODE
        }
    }

    # Determine which test command to run
    if ($Watch) {
        Write-Host 'Running frontend tests in watch mode...' -ForegroundColor Cyan
        npm run test:watch
    }
    elseif ($Coverage) {
        Write-Host 'Running frontend tests with coverage...' -ForegroundColor Cyan
        npm run test:coverage
        if ($LASTEXITCODE -eq 0) {
            $coverageDir = Join-Path $PWD 'coverage'
            $coverageIndex = Join-Path $coverageDir 'index.html'
            if (Test-Path $coverageIndex) {
                Write-Host "`nCoverage report: $coverageIndex" -ForegroundColor Yellow
                # Optionally open in browser on Windows
                if ($IsWindows -or ($PSVersionTable.PSVersion.Major -lt 6)) {
                    Start-Process $coverageIndex
                }
            }
        }
    }
    else {
        Write-Host 'Running frontend tests...' -ForegroundColor Cyan
        npm test
    }

    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        exit $LASTEXITCODE
    }

    Write-Host 'Frontend tests OK' -ForegroundColor Green

} finally {
    Pop-Location
}
