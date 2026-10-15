# Create the virtual environment, install dependencies, check them, and start
# the server. The game is served at http://127.0.0.1:8001/app/
#
# Usage (from the repository root):  powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 [-Port 8001] [-Reload]

param(
    [int]$Port = 8001,
    [switch]$Reload
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    # Find a Python 3.11+ interpreter: the py launcher first, then python on PATH.
    $PyExe = $null
    $PyArgs = @()
    $LauncherPath = Join-Path $env:LOCALAPPDATA "Programs\Python\Launcher\py.exe"
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $PyExe = (Get-Command py).Source; $PyArgs = @("-3")
    } elseif (Test-Path $LauncherPath) {
        $PyExe = $LauncherPath; $PyArgs = @("-3")
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        $PyExe = (Get-Command python).Source
    }
    if (-not $PyExe) {
        Write-Host "Python 3.11 or newer was not found. Install it from https://www.python.org/downloads/ and try again."
        exit 1
    }
    Write-Host "Creating virtual environment in .venv ..."
    & $PyExe @PyArgs -m venv .venv
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPython)) {
        Write-Host "Could not create the virtual environment. Install Python 3.11+ from https://www.python.org/downloads/ and try again."
        exit 1
    }
}

Write-Host "Installing dependencies ..."
& $VenvPython -m pip install --disable-pip-version-check -q -r requirements.txt
if ($LASTEXITCODE -ne 0) { Write-Host "Dependency installation failed (see above)."; exit 1 }

& $VenvPython scripts\check_env.py
if ($LASTEXITCODE -ne 0) { exit 1 }

$env:PYTHONPATH = Join-Path $Root "backend"
$ServerArgs = @("-m", "app", "--port", "$Port")
if ($Reload) { $ServerArgs += "--reload" }
& $VenvPython @ServerArgs
