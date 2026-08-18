# IQVault VIP stack -- one-shot launcher (desktop shortcut / Launch IQVault.bat)
# Starts only what is missing:
#   Docker Desktop -> Postgres -> Comics API -> VIP API -> collector -> Binder -> Orchestr8
# ASCII-only on purpose: Windows PowerShell 5.1 -File mis-parses UTF-8 punctuation (em-dash / arrows).
param(
    [switch]$NoBrowser,
    [switch]$InstallShortcut
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Container = "iqvault-postgres"
$ComposeFile = Join-Path $Root "docker-compose.yml"
$LogDir = Join-Path $PSScriptRoot "logs"
$LogFile = Join-Path $LogDir "launcher.log"
$ShortcutName = "IQVault.lnk"
$Ports = @{
    Postgres  = 5432
    ComicsApi = 5200
    Orchestr8 = 5210
    VipApi    = 8787
    IqVaultUi = 3000
    Binder    = 3010
}

function Write-Step([string]$Msg) {
    Write-Host "[IQVault] $Msg" -ForegroundColor Cyan
}

function Invoke-Native([scriptblock]$Cmd) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Cmd
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Get-NativeOutput([scriptblock]$Cmd) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        return & $Cmd
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Test-PortListening([int]$Port) {
    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
    } catch {
        return $false
    }
}

function Wait-Port([int]$Port, [int]$TimeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortListening $Port) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Wait-HttpJson([string]$Url, [scriptblock]$Ok, [int]$TimeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-RestMethod -Uri $Url -TimeoutSec 5
            if (& $Ok $r) { return $true }
        } catch {
            # still starting
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Start-MinimizedProcess([string]$Title, [string]$WorkingDir, [string]$CommandLine) {
    $arg = "/k title $Title && cd /d `"$WorkingDir`" && $CommandLine"
    Start-Process -FilePath "cmd.exe" -ArgumentList $arg -WorkingDirectory $WorkingDir -WindowStyle Minimized | Out-Null
}

function Install-DesktopShortcut {
    $bat = Join-Path $Root "Launch IQVault.bat"
    if (-not (Test-Path $bat)) {
        throw "Missing launcher: $bat"
    }
    $desktop = [Environment]::GetFolderPath("Desktop")
    $lnkPath = Join-Path $desktop $ShortcutName
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnkPath)
    $sc.TargetPath = $bat
    $sc.WorkingDirectory = $Root
    $sc.Description = "IQVault VIP stack -- Docker, Postgres, APIs, collector, Binder"
    $sc.WindowStyle = 1
    $icon = Join-Path $Root "assets\iqvault-icon.ico"
    if (Test-Path $icon) {
        $sc.IconLocation = "$icon,0"
    }
    $sc.Save()
    Write-Step "Desktop shortcut: $lnkPath"
}

function Test-DockerReady {
    $code = Invoke-Native { docker info 2>$null | Out-Null }
    return $code -eq 0
}

function Start-DockerDesktop {
    $paths = @(
        "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) {
            Write-Step "Starting Docker Desktop..."
            Start-Process -FilePath $p | Out-Null
            return $true
        }
    }
    return $false
}

function Ensure-Docker {
    if (Test-DockerReady) {
        Write-Step "Docker is ready."
        return
    }
    if (-not (Start-DockerDesktop)) {
        throw "Docker Desktop not found. Install Docker Desktop or start it manually."
    }
    Write-Step "Waiting for Docker (up to 3 min)..."
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        if (Test-DockerReady) {
            Write-Step "Docker is ready."
            return
        }
        Start-Sleep -Seconds 3
    }
    throw "Docker did not become ready in time. Open Docker Desktop manually and retry."
}

function Ensure-Postgres {
    $running = @(Get-NativeOutput { docker ps --filter "name=$Container" --format "{{.Names}}" 2>$null })
    if ($running -contains $Container) {
        Write-Step "Postgres container already running."
    } else {
        Write-Step "Starting Postgres ($Container)..."
        if (Test-Path $ComposeFile) {
            Push-Location $Root
            $composeCode = Invoke-Native { docker compose up -d postgres }
            if ($composeCode -ne 0) {
                Invoke-Native { docker start $Container } | Out-Null
            }
            Pop-Location
        } else {
            Invoke-Native { docker start $Container } | Out-Null
        }
        $runningNow = @(Get-NativeOutput { docker ps --filter "name=$Container" --format "{{.Names}}" 2>$null })
        if ($runningNow -notcontains $Container) {
            throw "Could not start Postgres container '$Container'. Run: docker logs $Container"
        }
        Invoke-Native { docker update --restart unless-stopped $Container } | Out-Null
    }

    Write-Step "Waiting for Postgres on port $($Ports.Postgres)..."
    if (-not (Wait-Port $Ports.Postgres 120)) {
        throw "Postgres port $($Ports.Postgres) not listening. Check: docker logs $Container"
    }

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        $code = Invoke-Native { docker exec $Container pg_isready -U postgres -d iqvault 2>$null | Out-Null }
        if ($code -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        throw "Postgres container up but not accepting connections yet."
    }
    Write-Step "Postgres ready."
}

function Ensure-NpmRoot {
    if (Test-Path (Join-Path $Root "node_modules")) { return }
    Write-Step "Installing workspace dependencies (first run)..."
    Push-Location $Root
    $code = Invoke-Native { npm install --no-fund --no-audit }
    Pop-Location
    if ($code -ne 0) {
        throw "npm install failed in $Root"
    }
}

function Ensure-ComicsApi {
    if (Test-PortListening $Ports.ComicsApi) {
        Write-Step "Comics API already on port $($Ports.ComicsApi)."
        return
    }
    Write-Step "Starting Comics API..."
    Start-MinimizedProcess "IQVault Comics API" $Root "python api\comics_server.py"
    if (-not (Wait-HttpJson "http://127.0.0.1:$($Ports.ComicsApi)/api/comics/health" { param($j) $j.ok -eq $true } 90)) {
        throw "Comics API failed to start on port $($Ports.ComicsApi)."
    }
    Write-Step "Comics API ready."
}

function Ensure-VipApi {
    if (Test-PortListening $Ports.VipApi) {
        Write-Step "VIP API already on port $($Ports.VipApi)."
        return
    }
    Ensure-NpmRoot
    Write-Step "Starting VIP API..."
    Start-MinimizedProcess "IQVault VIP API" $Root "npm run api"
    if (-not (Wait-HttpJson "http://127.0.0.1:$($Ports.VipApi)/health" { param($j) $j.ok -eq $true } 90)) {
        throw "VIP API failed to start on port $($Ports.VipApi)."
    }
    Write-Step "VIP API ready."
}

function Ensure-IqVaultUi {
    if (Test-PortListening $Ports.IqVaultUi) {
        Write-Step "Collector face already on port $($Ports.IqVaultUi)."
        return
    }
    Ensure-NpmRoot
    Write-Step "Starting collector face (apps/iqvault-web)..."
    Start-MinimizedProcess "IQVault Collector" $Root "npm run web"
    if (-not (Wait-Port $Ports.IqVaultUi 120)) {
        throw "Collector face failed to bind port $($Ports.IqVaultUi)."
    }
    Write-Step "Collector face ready."
}

function Ensure-Binder {
    if (Test-PortListening $Ports.Binder) {
        Write-Step "Binder already on port $($Ports.Binder)."
        return
    }
    Ensure-NpmRoot
    Write-Step "Starting Binder Vault (apps/binder-vault)..."
    Start-MinimizedProcess "Vault Binder" $Root "npm run binder"
    if (-not (Wait-Port $Ports.Binder 120)) {
        throw "Binder failed to bind port $($Ports.Binder)."
    }
    Write-Step "Binder ready."
}

function Ensure-Orchestr8 {
    if (Test-PortListening $Ports.Orchestr8) {
        Write-Step "Orchestr8 already on port $($Ports.Orchestr8)."
        return
    }
    Write-Step "Starting Orchestr8..."
    $orchRoot = Join-Path $Root "orchestr8"
    Start-MinimizedProcess "IQVault Orchestr8" $orchRoot "pip install -r requirements.txt -q 2>nul && python api\server.py"
    if (-not (Wait-HttpJson "http://127.0.0.1:$($Ports.Orchestr8)/v1/health" { param($j) $j.ok -eq $true } 90)) {
        Write-Host "[IQVault] WARN: Orchestr8 not healthy yet (check orchestr8/.env keys). UI will still load." -ForegroundColor Yellow
        return
    }
    Write-Step "Orchestr8 ready."
}

function Start-LauncherTranscript {
    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir | Out-Null
    }
    try {
        Start-Transcript -Path $LogFile -Append -ErrorAction Stop | Out-Null
    } catch {
        Write-Host "[IQVault] WARN: could not start transcript: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# --- main ---
if ($InstallShortcut) {
    Install-DesktopShortcut
}

Start-LauncherTranscript

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  IQVault VIP - starting stack" -ForegroundColor Green
Write-Host "  Collector  http://127.0.0.1:$($Ports.IqVaultUi)" -ForegroundColor Green
Write-Host "  Binder     http://127.0.0.1:$($Ports.Binder)/" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

try {
    Ensure-Docker
    Ensure-Postgres
    Ensure-ComicsApi
    Ensure-VipApi
    Ensure-IqVaultUi
    Ensure-Binder
    Ensure-Orchestr8

    if (-not $NoBrowser) {
        Start-Sleep -Seconds 1
        Start-Process "http://127.0.0.1:$($Ports.IqVaultUi)/"
        Start-Process "http://127.0.0.1:$($Ports.Binder)/"
    }

    Write-Host ""
    Write-Step "All services up."
    Write-Host "[IQVault] Collector: http://127.0.0.1:$($Ports.IqVaultUi)"
    Write-Host "[IQVault] Binder:    http://127.0.0.1:$($Ports.Binder)/"
    Write-Host "[IQVault] VIP API:   http://127.0.0.1:$($Ports.VipApi)/health"
    Write-Host ""

    if (-not $NoBrowser) {
        Read-Host "Press Enter to close this window (services keep running)"
    }
} catch {
    Write-Host ""
    Write-Host "[IQVault] ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}

try { Stop-Transcript | Out-Null } catch { }
