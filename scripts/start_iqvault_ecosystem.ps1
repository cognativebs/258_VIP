# IQVault VIP stack - one-shot launcher (desktop shortcut / Launch IQVault.bat)
# Starts only what is missing:
#   Docker Desktop -> Postgres -> Comics API -> VIP API -> collector web -> Binder -> Orchestr8
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

function Write-Warn([string]$Msg) {
    Write-Host "[IQVault] WARN: $Msg" -ForegroundColor Yellow
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
            if (& $Ok $r) { return $r }
        } catch {
            # still starting
        }
        Start-Sleep -Seconds 2
    }
    return $null
}

function Wait-HttpOk([string]$Url, [int]$TimeoutSec = 120) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch {
            # still starting
        }
        Start-Sleep -Seconds 2
    }
    return $false
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

function Test-DockerReady {
    $code = Invoke-Native { docker info 2>$null | Out-Null }
    return $code -eq 0
}

function Start-DockerDesktop {
    $paths = @(
        "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
        (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe")
    )
    foreach ($p in $paths) {
        if ($p -and (Test-Path $p)) {
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
    throw "Docker did not become ready in time. Open Docker Desktop manually and retry. Log: $LogFile"
}

function Get-PostgresContainerName {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        return (docker ps --filter "name=$Container" --format "{{.Names}}" 2>$null | Select-Object -First 1)
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Ensure-Postgres {
    $running = Get-PostgresContainerName
    if ($running -eq $Container) {
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
        if ((Get-PostgresContainerName) -ne $Container) {
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

function Start-MinimizedProcess([string]$Title, [string]$WorkingDir, [string]$CommandLine) {
    $arg = "/k title $Title && cd /d `"$WorkingDir`" && $CommandLine"
    Start-Process -FilePath "cmd.exe" -ArgumentList $arg -WorkingDirectory $WorkingDir -WindowStyle Minimized | Out-Null
}

function Start-VisibleProcess([string]$Title, [string]$WorkingDir, [string]$CommandLine) {
    $arg = "/k title $Title && cd /d `"$WorkingDir`" && $CommandLine"
    Start-Process -FilePath "cmd.exe" -ArgumentList $arg -WorkingDirectory $WorkingDir -WindowStyle Normal | Out-Null
}

function Ensure-NpmRoot {
    if (Test-Path (Join-Path $Root "node_modules")) { return }
    Write-Step "Installing workspace dependencies (first run)..."
    Push-Location $Root
    $code = Invoke-Native { npm install --no-fund --no-audit }
    Pop-Location
    if ($code -ne 0) {
        throw "npm install failed. See $LogFile"
    }
}

function Ensure-ComicsApi {
    if (Test-PortListening $Ports.ComicsApi) {
        Write-Step "Comics API already on port $($Ports.ComicsApi)."
        return
    }
    Write-Step "Starting Comics API..."
    Start-MinimizedProcess "IQVault Comics API" $Root "python api\comics_server.py"
    $health = Wait-HttpJson "http://127.0.0.1:$($Ports.ComicsApi)/api/comics/health" { param($j) $j.ok -eq $true } 90
    if (-not $health) {
        throw "Comics API failed to start on port $($Ports.ComicsApi)."
    }
    $holdings = $health.holdings
    if ($null -ne $holdings) {
        Write-Step "Comics API ready ($holdings holdings)."
    } else {
        Write-Step "Comics API ready."
    }
}

function Ensure-VipApi {
    if (Test-PortListening $Ports.VipApi) {
        Write-Step "VIP API already on port $($Ports.VipApi)."
        return
    }
    Ensure-NpmRoot
    Write-Step "Starting VIP API..."
    Start-MinimizedProcess "IQVault VIP API" $Root "npm run api"
    $health = Wait-HttpJson "http://127.0.0.1:$($Ports.VipApi)/health" { param($j) $j.ok -eq $true } 90
    if (-not $health) {
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
    Start-VisibleProcess "IQVault Web" $Root "npm run web"
    if (-not (Wait-Port $Ports.IqVaultUi 120)) {
        throw "Collector face failed to bind port $($Ports.IqVaultUi)."
    }
    if (-not (Wait-HttpOk "http://127.0.0.1:$($Ports.IqVaultUi)/" 90)) {
        Write-Warn "Port $($Ports.IqVaultUi) is listening but HTTP is not ready yet. Opening anyway."
        return
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
    Start-VisibleProcess "IQVault Binder" $Root "npm run binder"
    if (-not (Wait-Port $Ports.Binder 120)) {
        throw "Binder failed to bind port $($Ports.Binder)."
    }
    if (-not (Wait-HttpOk "http://127.0.0.1:$($Ports.Binder)/" 90)) {
        Write-Warn "Port $($Ports.Binder) is listening but HTTP is not ready yet. Opening anyway."
        return
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
    $health = Wait-HttpJson "http://127.0.0.1:$($Ports.Orchestr8)/v1/health" { param($j) $j.ok -eq $true } 90
    if (-not $health) {
        Write-Warn "Orchestr8 not healthy yet (check orchestr8/.env keys). UI will still load."
        return
    }
    Write-Step "Orchestr8 ready."
}

function Install-DesktopShortcut {
    $bat = Join-Path $Root "Launch IQVault.bat"
    if (-not (Test-Path $bat)) {
        throw "Missing launcher: $bat"
    }
    $desktop = [Environment]::GetFolderPath("Desktop")
    $lnkPath = Join-Path $desktop $ShortcutName
    $icon = Join-Path $Root "assets\iqvault-icon.ico"
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnkPath)
    $sc.TargetPath = $bat
    $sc.Arguments = ""
    $sc.WorkingDirectory = $Root
    $sc.Description = "Start IQVault collector stack (Docker, Postgres, APIs, web, Binder)"
    if (Test-Path $icon) {
        $sc.IconLocation = "$icon,0"
    }
    $sc.Save()
    Write-Step "Desktop shortcut: $lnkPath"
}

function Start-LauncherLog {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    try {
        Start-Transcript -Path $LogFile -Append -Force | Out-Null
        return $true
    } catch {
        Write-Warn "Could not start launcher log ($LogFile): $($_.Exception.Message)"
        return $false
    }
}

# --- main ---
if ($InstallShortcut) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  IQVault - install desktop shortcut" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Install-DesktopShortcut
    exit 0
}

$transcript = Start-LauncherLog

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  IQVault VIP - starting stack" -ForegroundColor Green
    Write-Host "  Collector  http://127.0.0.1:$($Ports.IqVaultUi)" -ForegroundColor Green
    Write-Host "  Binder     http://localhost:$($Ports.Binder)/" -ForegroundColor Green
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
        Start-Process "http://localhost:$($Ports.Binder)/"
    }

    Write-Host ""
    Write-Step "All services up."
    Write-Step "Collector: http://127.0.0.1:$($Ports.IqVaultUi)"
    Write-Step "Binder:    http://localhost:$($Ports.Binder)/"
    Write-Host ""
} catch {
    Write-Host ""
    Write-Host "[IQVault] ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "[IQVault] Log: $LogFile" -ForegroundColor DarkGray
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
} finally {
    if ($transcript) {
        try { Stop-Transcript | Out-Null } catch { }
    }
}
