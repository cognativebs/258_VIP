# IQVault VIP stack - one-shot launcher (desktop shortcut / Launch IQVault.bat)
# Docker -> Postgres -> DB migrations -> VIP API -> Comics API -> Orchestr8 ->
# web UI -> Binder, then opens the browser.
#
# A listening port is NOT treated as healthy. Stale listeners (old VIP API,
# leftover next-dev on 3000/3010, leftover Comics API) are killed and restarted.
param(
    [switch]$NoBrowser,
    [switch]$WithBinder,
    [switch]$NoBinder,
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
    VipApi    = 8787
    ComicsApi = 5200
    Orchestr8        = 5210
    Web              = 3000
    Orchestr8Console = 3001
    Binder           = 3010
}

function Write-Step([string]$Msg) {
    Write-Host "[IQVault] $Msg" -ForegroundColor Cyan
}

function Write-Checkout {
    try {
        Push-Location $Root
        $branch = (git branch --show-current 2>$null)
        $sha = (git rev-parse --short HEAD 2>$null)
        $msg = (git log -1 --pretty=%s 2>$null)
        if ($sha) {
            Write-Step ("Checkout {0} @ {1} — {2}" -f $branch, $sha, $msg)
        }
    } catch {
    } finally {
        Pop-Location
    }
}

function Write-Warn([string]$Msg) {
    Write-Host "[IQVault] WARN: $Msg" -ForegroundColor Yellow
}

function Test-PortListening([int]$Port) {
    # Get-NetTCPConnection often throws or returns nothing when this script is
    # started from a double-clicked .bat (no admin, NetTCPIP missing). TcpClient
    # is the fallback so "already running" / Wait-Port still work.
    try {
        $hit = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $hit) { return $true }
    } catch {}
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(400)
        if ($ok -and $client.Connected) { return $true }
    } catch {
        return $false
    } finally {
        if ($client) { $client.Close() }
    }
    return $false
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
        "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
        (Join-Path $env:LOCALAPPDATA "Docker\Docker\Docker Desktop.exe")
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

function Get-WorkspacePackageNames {
    # Names declared by every workspace package.json under packages/ apps/ services/.
    $names = @()
    foreach ($group in @("packages", "apps", "services")) {
        $dir = Join-Path $Root $group
        if (-not (Test-Path $dir)) { continue }
        foreach ($pkg in Get-ChildItem -Path $dir -Directory -ErrorAction SilentlyContinue) {
            $manifest = Join-Path $pkg.FullName "package.json"
            if (-not (Test-Path $manifest)) { continue }
            try {
                $json = Get-Content $manifest -Raw | ConvertFrom-Json
                if ($json.name) { $names += $json.name }
            } catch {
                # unreadable manifest is not fatal for the link check
            }
        }
    }
    return $names
}

function Get-MissingWorkspaceLinks {
    # A `git pull` that adds a workspace (e.g. @vip/scan-ingest) leaves the old
    # node_modules in place with no link for it, so `npm run api` dies with
    # ERR_MODULE_NOT_FOUND even though node_modules exists.
    $missing = @()
    foreach ($name in (Get-WorkspacePackageNames)) {
        $linkPath = Join-Path (Join-Path $Root "node_modules") ($name -replace "/", [IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path $linkPath)) { $missing += $name }
    }
    return $missing
}

function Ensure-NodeModules {
    $modules = Join-Path $Root "node_modules"
    if (-not (Test-Path $modules)) {
        Write-Step "Installing npm dependencies (first run - this can take a few minutes)..."
        Push-Location $Root
        npm ci
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { throw "npm ci failed." }
        return
    }

    # @() so a single missing name stays an array rather than a bare string.
    $missing = @(Get-MissingWorkspaceLinks)
    if ($missing.Count -gt 0) {
        Write-Warn "node_modules is missing workspace(s): $($missing -join ', ') - running npm install."
        Push-Location $Root
        npm install
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { throw "npm install failed - run it manually and re-launch." }

        $still = @(Get-MissingWorkspaceLinks)
        if ($still.Count -gt 0) {
            throw "Workspace(s) still unlinked after npm install: $($still -join ', ')"
        }
        Write-Step "Workspace links repaired."
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

function Repair-ProcessPath {
    # Explorer-launched .bat files often have a truncated PATH, so python/npm/docker
    # "are installed" in a terminal but missing on double-click.
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $parts = @($machine, $user, $env:Path) | Where-Object { $_ }
    if ($parts.Count -gt 0) {
        $env:Path = ($parts -join ";")
    }
}

function Install-DesktopShortcut {
    $shortcutScript = Join-Path $PSScriptRoot "create_iqvault_shortcut.ps1"
    if (-not (Test-Path $shortcutScript)) { return }
    try {
        & $shortcutScript
    } catch {
        Write-Warn "Could not refresh desktop IQVault.lnk: $($_.Exception.Message)"
    }
}

function Ensure-PythonDeps {
    Write-Step "Checking Python dependencies (psycopg2)..."
    $req = Join-Path $Root "requirements-dev.txt"
    if (-not (Test-Path $req)) { return }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $py = Get-Command python -ErrorAction SilentlyContinue
        $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
        if ($py) {
            python -m pip install -r $req -q
        } elseif ($pyLauncher) {
            py -3 -m pip install -r $req -q
        } else {
            Write-Warn "python not on PATH - install Python 3 or open a terminal and run Launch IQVault.bat from there."
            return
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "pip install had a non-zero exit - Comics API may fail until: python -m pip install -r requirements-dev.txt"
        }
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Ensure-Migrated {
    Write-Step "Applying database migrations..."
    Push-Location $Root
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        if (Get-Command python -ErrorAction SilentlyContinue) {
            python scripts/migrate_db.py
        } elseif (Get-Command py -ErrorAction SilentlyContinue) {
            py -3 scripts/migrate_db.py
        } else {
            Write-Warn "python not on PATH - skipped migrations."
            return
        }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
        Pop-Location
    }
    if ($code -ne 0) {
        Write-Warn "migrate_db.py reported a failure - VIP API may not serve comics. See the output above."
    } else {
        Write-Step "Migrations applied."
    }
}

function Get-PidsOnPort([int]$Port) {
    $ids = @()
    try {
        $ids = @(
            Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
        )
    } catch {}
    if (-not $ids -or @($ids).Count -eq 0) {
        # Double-click Launch often has no NetTCPIP module; netstat still works.
        try {
            foreach ($line in (netstat -ano)) {
                if ($line -notmatch "LISTENING") { continue }
                if ($line -notmatch ":$Port\s") { continue }
                $parts = ($line.Trim() -split "\s+")
                $procId = $parts[-1]
                if ($procId -match "^\d+$") { $ids += [int]$procId }
            }
            $ids = @($ids | Select-Object -Unique)
        } catch {}
    }
    return @($ids)
}

function Stop-ProcessesOnPort([int]$Port) {
    $procIds = Get-PidsOnPort $Port
    foreach ($procId in $procIds) {
        try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
    }
    if ($procIds -and @($procIds).Count -gt 0) {
        # Give the OS a moment to actually free the socket before rebinding.
        Start-Sleep -Seconds 2
        # Second pass - Windows sometimes leaves a dying listener briefly.
        $still = Get-PidsOnPort $Port
        foreach ($procId in $still) {
            try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
        }
        if ($still -and @($still).Count -gt 0) { Start-Sleep -Seconds 1 }
    }
}

function Test-VipApiCurrent {
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$($Ports.VipApi)/health" -TimeoutSec 5
        # Current 258_VIP API. Leftover IQVault sqlite-era processes on :8787
        # either have no /health or a different service name.
        return ($r.ok -eq $true) -and ($r.service -eq "vip-api")
    } catch {
        return $false
    }
}

function Ensure-VipApi {
    if (Test-PortListening $Ports.VipApi) {
        Write-Warn "Restarting VIP API on port $($Ports.VipApi) so it is the current 258_VIP process."
        Stop-ProcessesOnPort $Ports.VipApi
    }
    Write-Step "Starting VIP API..."
    Start-MinimizedProcess "IQVault VIP API" $Root "npm run api"
    if (-not (Wait-HttpJson "http://127.0.0.1:$($Ports.VipApi)/health" { param($j) ($j.ok -eq $true) -and ($j.service -eq "vip-api") } 90)) {
        throw "VIP API failed to start on port $($Ports.VipApi). Check the 'IQVault VIP API' window, or run: npm run api"
    }
    Write-Step "VIP API ready."
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$($Ports.VipApi)/health" -TimeoutSec 5
        if ($h.ebayComps -and $h.ebayComps.configured -eq $true) {
            Write-Step ("eBay comps {0} ({1})" -f $h.ebayComps.mode, $h.ebayComps.environment)
        } else {
            Write-Warn "eBay comps idle — add EBAY_APP_ID + EBAY_CERT_ID to services\api\.env (see docs/how-to/10-ebay-comps.md)."
        }
    } catch {}
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
        Write-Warn "Restarting Comics API on port $($Ports.ComicsApi) so it is the current 258_VIP process."
        Stop-ProcessesOnPort $Ports.ComicsApi
    }
    Write-Step "Starting Comics API..."
    Start-MinimizedProcess "IQVault Comics API" $Root "python api\comics_server.py"
    if (-not (Wait-HttpJson "http://127.0.0.1:$($Ports.ComicsApi)/api/comics/health" { param($j) $j.ok -eq $true } 90)) {
        throw "Comics API failed to start on port $($Ports.ComicsApi). Check the 'IQVault Comics API' window, or run: npm run comics"
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
    # Leftover next-dev on 3000 is why Comics Terminal kept showing
    # "Read-only on VIP fallback" after the VIP path became editable.
    if (Test-PortListening $Ports.Web) {
        Write-Warn "Restarting IQVault web on port $($Ports.Web) so it picks up the current checkout."
        Stop-ProcessesOnPort $Ports.Web
    }
    Write-Step "Starting IQVault web..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k title IQVault Web && cd /d `"$Root`" && npm run web" -WorkingDirectory $Root -WindowStyle Normal | Out-Null
    if (-not (Wait-Port $Ports.Web 120)) {
        throw "IQVault web failed to bind port $($Ports.Web)."
    }
    Write-Step "IQVault web ready."
}

function Ensure-Binder {
    # Binder is part of the stack. -WithBinder is kept as a no-op alias;
    # pass -NoBinder to skip. A leftover next-dev on 3010 is why a git
    # checkout plus relaunch used to show the old UI.
    if ($NoBinder) { return }
    if (Test-PortListening $Ports.Binder) {
        Write-Warn "Restarting Binder on port $($Ports.Binder) so it picks up the current checkout."
        Stop-ProcessesOnPort $Ports.Binder
    }
    Write-Step "Starting Binder Vault..."
    Start-MinimizedProcess "IQVault Binder" $Root "npm run binder"
    if (-not (Wait-Port $Ports.Binder 120)) {
        Write-Warn "Binder did not bind port $($Ports.Binder) - skip or start later with: npm run binder"
        return
    }
    Write-Step "Binder ready on http://127.0.0.1:$($Ports.Binder)"
}

function Ensure-Orchestr8Console {
    # Companion app, same as Binder: started with the stack, not auto-opened.
    # Open it from Orchestr8 ↗ in the IQVault header.
    if (Test-PortListening $Ports.Orchestr8Console) {
        Write-Warn "Restarting Orchestr8 Console on port $($Ports.Orchestr8Console) so it picks up the current checkout."
        Stop-ProcessesOnPort $Ports.Orchestr8Console
    }
    Write-Step "Starting Orchestr8 Console..."
    Start-MinimizedProcess "IQVault Orchestr8 Console" $Root "npm run orchestr8:console"
    if (-not (Wait-Port $Ports.Orchestr8Console 120)) {
        Write-Warn "Orchestr8 Console did not bind port $($Ports.Orchestr8Console) - skip or start later with: npm run orchestr8:console"
        return
    }
    Write-Step "Orchestr8 Console ready on http://127.0.0.1:$($Ports.Orchestr8Console)"
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
            $inv = Invoke-RestMethod -Uri "http://127.0.0.1:$($Ports.VipApi)/api/inventory" -TimeoutSec 30
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
    Write-Step ("  Web        {0}  http://127.0.0.1:{1}/" -f $webLabel, $Ports.Web)
    $consoleOk = Test-PortListening $Ports.Orchestr8Console
    $consoleLabel = if ($consoleOk) { "OK" } else { "DOWN" }
    Write-Step ("  Console    {0}  http://127.0.0.1:{1}" -f $consoleLabel, $Ports.Orchestr8Console)
    if (-not $NoBinder) {
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
Repair-ProcessPath
try {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    Start-Transcript -Path $LogFile -Force | Out-Null
} catch {}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  IQVault VIP - starting stack" -ForegroundColor Green
Write-Host "  http://127.0.0.1:$($Ports.Web)/" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Checkout

try {
    Install-DesktopShortcut
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
    Ensure-Orchestr8Console

    if (-not $NoBrowser) {
        Start-Sleep -Seconds 1
        Start-Process "http://127.0.0.1:$($Ports.Web)/"
        # One IQVault tab. Binder and Orchestr8 Console stay in the stack
        # and open from Binder ↗ / Orchestr8 ↗ in the header.
    }

    Write-StackSummary
} catch {
    Write-Host ""
    Write-Host "[IQVault] ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "[IQVault] Log: $LogFile" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to close"
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}

try { Stop-Transcript | Out-Null } catch {}
