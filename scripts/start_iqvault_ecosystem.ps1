# IQVault VIP stack — one-shot launcher (desktop shortcut / Launch IQVault.bat)
# Starts only what is missing: Docker Desktop → Postgres → Comics API → Orchestr8 → UI
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Container = "iqvault-postgres"
$ComposeFile = Join-Path $Root "docker-compose.yml"
$Ports = @{
    Postgres   = 5432
    ComicsApi  = 5200
    Orchestr8  = 5210
    IqVaultUi  = 5175
}

function Write-Step([string]$Msg) {
    Write-Host "[IQVault] $Msg" -ForegroundColor Cyan
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

function Test-DockerReady {
    $null = docker info 2>$null
    return $LASTEXITCODE -eq 0
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
    $running = docker ps --filter "name=$Container" --format "{{.Names}}" 2>$null
    if ($running -eq $Container) {
        Write-Step "Postgres container already running."
    } else {
        Write-Step "Starting Postgres ($Container)..."
        if (Test-Path $ComposeFile) {
            Push-Location $Root
            docker compose up -d postgres 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                docker start $Container 2>&1 | Out-Null
            }
            Pop-Location
        } else {
            docker start $Container 2>&1 | Out-Null
        }
        if ($LASTEXITCODE -ne 0) {
            throw "Could not start Postgres container '$Container'. Run: docker logs $Container"
        }
        # Auto-start after reboot when Docker Desktop is running
        docker update --restart unless-stopped $Container 2>$null | Out-Null
    }

    Write-Step "Waiting for Postgres on port $($Ports.Postgres)..."
    if (-not (Wait-Port $Ports.Postgres 120)) {
        throw "Postgres port $($Ports.Postgres) not listening. Check: docker logs $Container"
    }

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        docker exec $Container pg_isready -U postgres -d iqvault 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        throw "Postgres container up but not accepting connections yet."
    }
    Write-Step "Postgres ready."
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

function Ensure-IqVaultUi {
    $iqDir = Join-Path $Root "iqvault"
    if (-not (Test-Path (Join-Path $iqDir "node_modules"))) {
        Write-Step "Installing IQVault UI dependencies (first run)..."
        Push-Location $iqDir
        npm install --no-fund --no-audit
        Pop-Location
    }

    if (Test-PortListening $Ports.IqVaultUi) {
        Write-Step "IQVault UI already on port $($Ports.IqVaultUi)."
        return
    }

    Write-Step "Starting IQVault UI..."
    $arg = "/k title IQVault UI && cd /d `"$iqDir`" && npm run dev"
    Start-Process -FilePath "cmd.exe" -ArgumentList $arg -WorkingDirectory $iqDir -WindowStyle Normal | Out-Null

    if (-not (Wait-Port $Ports.IqVaultUi 120)) {
        throw "IQVault UI failed to bind port $($Ports.IqVaultUi)."
    }
    Write-Step "IQVault UI ready."
}

# --- main ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  IQVault VIP — starting stack" -ForegroundColor Green
Write-Host "  http://127.0.0.1:$($Ports.IqVaultUi)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

try {
    Ensure-Docker
    Ensure-Postgres
    Ensure-ComicsApi
    Ensure-Orchestr8
    Ensure-IqVaultUi

    if (-not $NoBrowser) {
        Start-Sleep -Seconds 1
        Start-Process "http://127.0.0.1:$($Ports.IqVaultUi)/"
    }

    Write-Host ""
    Write-Step "All services up. Login: greg@iqvault.local / vault"
    Write-Host ""
} catch {
    Write-Host ""
    Write-Host "[IQVault] ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}
