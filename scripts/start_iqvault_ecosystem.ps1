# IQVault VIP stack - one-shot launcher (desktop shortcut / Launch IQVault.bat)
# Starts only what is missing: Docker -> Postgres -> DB migrations -> VIP API ->
# Comics API -> Orchestr8 -> web UI, then opens the browser.
#
# A listening port is NOT treated as healthy. Stale or half-dead processes
# (old VIP sample API, broken Orchestr8 that accepts then closes) are killed
# and restarted.
param(
    [switch]$NoBrowser,
    [switch]$WithBinder
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Container = "iqvault-postgres"
$ComposeFile = Join-Path $Root "docker-compose.yml"
$Ports = @{
    Postgres  = 5432
    VipApi    = 8787
    ComicsApi = 5200
    Orchestr8 = 5210
    Web       = 3000
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
            if (& $Ok $r) { return $true }
        } catch {
            # still starting, or broken listener that closes early
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Start-MinimizedProcess([string]$Title, [string]$WorkingDir, [string]$CommandLine) {
    $arg = "/k title $Title && cd /d `"$WorkingDir`" && $CommandLine"
    Start-Process -FilePath "cmd.exe" -ArgumentList $arg -WorkingDirectory $WorkingDir -WindowStyle Minimized | Out-Null
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
        throw "Docker Desktop not found. Install Docker Desktop or start Postgres another way."
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
    $existing = docker ps -a --filter "name=$Container" --format "{{.Names}}" 2>$null
    if ($existing -eq $Container) {
        $running = docker ps --filter "name=$Container" --format "{{.Names}}" 2>$null
        if ($running -eq $Container) {
            Write-Step "Postgres container already running."
        } else {
            Write-Step "Starting existing Postgres container..."
            docker start $Container 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Could not start Postgres container '$Container'. Run: docker logs $Container"
            }
        }
    } else {
        Write-Step "Creating Postgres container..."
        if (Test-Path $ComposeFile) {
            Push-Location $Root
            docker compose up -d 2>&1 | Out-Null
            Pop-Location
        } else {
            throw "docker-compose.yml not found at $ComposeFile."
        }
        if ($LASTEXITCODE -ne 0) {
            throw "Could not create Postgres container. Run: docker compose up -d"
        }
    }
    docker update --restart unless-stopped $Container 2>$null | Out-Null

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

function Ensure-NodeModules {
    if (-not (Test-Path (Join-Path $Root "node_modules"))) {
        Write-Step "Installing npm dependencies (first run - this can take a few minutes)..."
        Push-Location $Root
        npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
        Pop-Location
    }
}

function Ensure-PackagesBuilt {
    # @vip/evidence etc. resolve through gitignored dist/ - every workspace
    # that imports them (API, web) fails ERR_MODULE_NOT_FOUND without this.
    Write-Step "Building shared packages..."
    Push-Location $Root
    npm run build:packages
    if ($LASTEXITCODE -ne 0) { throw "npm run build:packages failed." }
    Pop-Location
}

function Ensure-PythonDeps {
    Write-Step "Checking Python dependencies (psycopg2, pytest)..."
    Push-Location $Root
    pip install -r requirements-dev.txt -q
    Pop-Location
}

function Ensure-Migrated {
    Write-Step "Applying database migrations..."
    Push-Location $Root
    python scripts/migrate_db.py
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) {
        Write-Warn "migrate_db.py reported a failure - VIP API may not serve comics. See the output above."
    } else {
        Write-Step "Migrations applied."
    }
}

function Stop-ProcessesOnPort([int]$Port) {
    $procIds = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $procIds) {
        try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
    }
    if ($procIds) {
        # Give the OS a moment to actually free the socket before rebinding.
        Start-Sleep -Seconds 2
        # Second pass - Windows sometimes leaves a dying listener briefly.
        $still = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $still) {
            try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
        }
        if ($still) { Start-Sleep -Seconds 1 }
    }
}

function Test-VipApiCurrent {
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$($Ports.VipApi)/api/inventory" -TimeoutSec 5
        # comicsAvailable only exists on the current schema. A process left
        # running from before the live-Postgres correction answers on this same
        # port with the old 120-sample + 5-seed shape and no such field -
        # "already on this port" must not be mistaken for "healthy".
        return $null -ne $r.PSObject.Properties['comicsAvailable']
    } catch {
        return $false
    }
}

function Ensure-VipApi {
    if (Test-PortListening $Ports.VipApi) {
        if (Test-VipApiCurrent) {
            Write-Step "VIP API already healthy on port $($Ports.VipApi)."
            return
        }
        Write-Warn "Port $($Ports.VipApi) is serving an outdated or broken VIP API - restarting it."
        Stop-ProcessesOnPort $Ports.VipApi
    }
    Write-Step "Starting VIP API..."
    Start-MinimizedProcess "IQVault VIP API" $Root "npm run api"
    if (-not (Wait-HttpJson "http://127.0.0.1:$($Ports.VipApi)/api/inventory" { param($j) $null -ne $j.PSObject.Properties['comicsAvailable'] } 90)) {
        throw "VIP API failed to start on port $($Ports.VipApi). Check the 'IQVault VIP API' window."
    }
    Write-Step "VIP API ready."
}

function Test-ComicsApiHealthy {
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$($Ports.ComicsApi)/api/comics/health" -TimeoutSec 5
        return $r.ok -eq $true
    } catch {
        return $false
    }
}

function Ensure-ComicsApi {
    if (Test-PortListening $Ports.ComicsApi) {
        if (Test-ComicsApiHealthy) {
            Write-Step "Comics API already healthy on port $($Ports.ComicsApi)."
            return
        }
        Write-Warn "Port $($Ports.ComicsApi) is listening but unhealthy - restarting Comics API."
        Stop-ProcessesOnPort $Ports.ComicsApi
    }
    Write-Step "Starting Comics API..."
    Start-MinimizedProcess "IQVault Comics API" $Root "python api\comics_server.py"
    if (-not (Wait-HttpJson "http://127.0.0.1:$($Ports.ComicsApi)/api/comics/health" { param($j) $j.ok -eq $true } 90)) {
        Write-Warn "Comics API not healthy yet - the Comics tab will fall back to VIP (read-only)."
        return
    }
    Write-Step "Comics API ready."
}

function Ensure-Orchestr8Env {
    $orchRoot = Join-Path $Root "orchestr8"
    $envFile = Join-Path $orchRoot ".env"
    $envExample = Join-Path $orchRoot ".env.example"
    if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
        Copy-Item $envExample $envFile
        Write-Warn "Created orchestr8\.env from the template - add a provider key (OPENAI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY) to enable Ask."
    }
}

function Test-Orchestr8Healthy {
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$($Ports.Orchestr8)/v1/health" -TimeoutSec 5
        # Must be the Orchestr8 gateway shape. A dead/half-open listener
        # (Accept then ResponseEnded) fails the Invoke and returns false -
        # that is the failure mode that kept Comics Ask offline tonight.
        return ($r.service -eq "orchestr8") -and ($null -ne $r.providers)
    } catch {
        return $false
    }
}

function Ensure-Orchestr8 {
    if (Test-PortListening $Ports.Orchestr8) {
        if (Test-Orchestr8Healthy) {
            Write-Step "Orchestr8 already healthy on port $($Ports.Orchestr8)."
            return
        }
        Write-Warn "Port $($Ports.Orchestr8) is listening but not a healthy Orchestr8 gateway - restarting it."
        Stop-ProcessesOnPort $Ports.Orchestr8
    }
    Ensure-Orchestr8Env
    Write-Step "Starting Orchestr8..."
    $orchRoot = Join-Path $Root "orchestr8"
    Start-MinimizedProcess "IQVault Orchestr8" $orchRoot "pip install -r requirements.txt -q 2>nul && python api\server.py"
    if (-not (Wait-HttpJson "http://127.0.0.1:$($Ports.Orchestr8)/v1/health" { param($j) $j.service -eq "orchestr8" } 90)) {
        Write-Warn "Orchestr8 not reachable yet. Ask on the Comics tab will stay disabled until it is."
        return
    }
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$($Ports.Orchestr8)/v1/health" -TimeoutSec 5
        $anyKey = $false
        if ($h.providers) {
            foreach ($p in $h.providers.PSObject.Properties) {
                if ($p.Value -eq $true) { $anyKey = $true; break }
            }
        }
        if ($anyKey) {
            Write-Step "Orchestr8 ready (providers: $($h.providers | ConvertTo-Json -Compress))."
        } else {
            Write-Warn "Orchestr8 is up but no provider keys are set - add keys to orchestr8\.env and restart Orchestr8 for Ask."
        }
    } catch {
        Write-Step "Orchestr8 gateway is up."
    }
}

function Ensure-Web {
    if (Test-PortListening $Ports.Web) {
        Write-Step "IQVault web already on port $($Ports.Web)."
        return
    }
    Write-Step "Starting IQVault web..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k title IQVault Web && cd /d `"$Root`" && npm run web" -WorkingDirectory $Root -WindowStyle Normal | Out-Null
    if (-not (Wait-Port $Ports.Web 120)) {
        throw "IQVault web failed to bind port $($Ports.Web)."
    }
    Write-Step "IQVault web ready."
}

function Ensure-Binder {
    if (-not $WithBinder) { return }
    if (Test-PortListening $Ports.Binder) {
        Write-Step "Binder already on port $($Ports.Binder)."
        return
    }
    Write-Step "Starting Binder Vault..."
    Start-MinimizedProcess "IQVault Binder" $Root "npm run binder"
    if (-not (Wait-Port $Ports.Binder 120)) {
        Write-Warn "Binder did not bind port $($Ports.Binder) - skip or start later with: npm run binder"
        return
    }
    Write-Step "Binder ready on http://127.0.0.1:$($Ports.Binder)"
}

function Write-StackSummary {
    Write-Host ""
    Write-Step "Stack health check:"

    $vipOk = Test-VipApiCurrent
    $comicsOk = Test-ComicsApiHealthy
    $orchOk = Test-Orchestr8Healthy
    $webOk = Test-PortListening $Ports.Web

    $comicsCount = "?"
    if ($vipOk) {
        try {
            $inv = Invoke-RestMethod -Uri "http://127.0.0.1:$($Ports.VipApi)/api/inventory" -TimeoutSec 5
            if ($null -ne $inv.comicsCount) { $comicsCount = $inv.comicsCount }
        } catch {}
    }

    $orchProviders = "n/a"
    if ($orchOk) {
        try {
            $h = Invoke-RestMethod -Uri "http://127.0.0.1:$($Ports.Orchestr8)/v1/health" -TimeoutSec 5
            $orchProviders = ($h.providers | ConvertTo-Json -Compress)
        } catch {}
    }

    $vipLabel = if ($vipOk) { "OK" } else { "DOWN" }
    $comicsLabel = if ($comicsOk) { "OK" } else { "DOWN" }
    $orchLabel = if ($orchOk) { "OK" } else { "DOWN" }
    $webLabel = if ($webOk) { "OK" } else { "DOWN" }

    Write-Step ("  VIP API    {0}  http://127.0.0.1:{1}  comicsCount={2}" -f $vipLabel, $Ports.VipApi, $comicsCount)
    Write-Step ("  Comics API {0}  http://127.0.0.1:{1}" -f $comicsLabel, $Ports.ComicsApi)
    Write-Step ("  Orchestr8  {0}  http://127.0.0.1:{1}  providers={2}" -f $orchLabel, $Ports.Orchestr8, $orchProviders)
    Write-Step ("  Web        {0}  http://127.0.0.1:{1}/collections/comics" -f $webLabel, $Ports.Web)
    if ($WithBinder) {
        $binderOk = Test-PortListening $Ports.Binder
        $binderLabel = if ($binderOk) { "OK" } else { "DOWN" }
        Write-Step ("  Binder     {0}  http://127.0.0.1:{1}" -f $binderLabel, $Ports.Binder)
    }
    Write-Host ""
    Write-Step "Leave the service windows open. Stop everything with: Stop IQVault.bat"
    if (-not $orchOk) {
        Write-Warn "Ask on Comics needs a healthy Orchestr8. Fix keys in orchestr8\.env then re-run this launcher."
    }
    Write-Step "If the collection looks empty, import once:"
    Write-Step "  python scripts/import_clz.py --xml YOUR_EXPORT.xml"
    Write-Host ""
}

# --- main ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  IQVault VIP - starting stack" -ForegroundColor Green
Write-Host "  http://127.0.0.1:$($Ports.Web)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

try {
    Ensure-Docker
    Ensure-Postgres
    Ensure-NodeModules
    Ensure-PackagesBuilt
    Ensure-PythonDeps
    Ensure-Migrated
    Ensure-VipApi
    Ensure-ComicsApi
    Ensure-Orchestr8
    Ensure-Web
    Ensure-Binder

    if (-not $NoBrowser) {
        Start-Sleep -Seconds 1
        Start-Process "http://127.0.0.1:$($Ports.Web)/collections/comics"
    }

    Write-StackSummary
} catch {
    Write-Host ""
    Write-Host "[IQVault] ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}
