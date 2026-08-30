# Stop every IQVault VIP service window (does not stop Postgres/Docker).
param(
    [switch]$InstallShortcut
)

$ErrorActionPreference = "Continue"
$Ports = 8787, 5200, 5210, 3000, 3001, 3010
$WindowTitles = @(
    "IQVault VIP API",
    "IQVault Comics API",
    "IQVault Orchestr8 Console",
    "IQVault Orchestr8",
    "IQVault Binder",
    "IQVault Web"
)

function Get-PidsOnPort([int]$Port) {
    $ids = @()
    try {
        $ids = @(
            Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
        )
    } catch {}
    if (-not $ids -or @($ids).Count -eq 0) {
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

function Stop-PidTree([int]$ProcId) {
    if ($ProcId -le 0) { return }
    try {
        $name = (Get-Process -Id $ProcId -ErrorAction SilentlyContinue).ProcessName
        if (-not $name) { return }
        Write-Host "[IQVault] Stopping pid $ProcId ($name)" -ForegroundColor Cyan
        # /T closes npm/cmd parents together with node/python children.
        & taskkill.exe /PID $ProcId /T /F 2>$null | Out-Null
    } catch {}
}

function Stop-TitledWindows {
    foreach ($title in $WindowTitles) {
        $hit = & taskkill.exe /F /T /FI "WINDOWTITLE eq $title*" 2>&1
        $text = ($hit | Out-String)
        if ($text -match "SUCCESS") {
            Write-Host "[IQVault] Closed window: $title" -ForegroundColor Cyan
        }
    }
}

if ($InstallShortcut) {
    $shortcut = Join-Path $PSScriptRoot "create_stop_iqvault_shortcut.ps1"
    if (Test-Path $shortcut) {
        try {
            & $shortcut
        } catch {
            Write-Host "[IQVault] WARN: could not refresh Desktop Stop IQVault shortcut: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  IQVault VIP - stopping app services" -ForegroundColor Yellow
Write-Host "  Postgres / Docker stay running" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

Stop-TitledWindows

foreach ($port in $Ports) {
    $procIds = Get-PidsOnPort $port
    foreach ($procId in $procIds) {
        Write-Host "[IQVault] Port $port still listening" -ForegroundColor Cyan
        Stop-PidTree $procId
    }
}

Start-Sleep -Seconds 1
$left = @()
foreach ($port in $Ports) {
    $still = Get-PidsOnPort $port
    foreach ($procId in $still) {
        Stop-PidTree $procId
        $left += $port
    }
}

$busy = @()
foreach ($port in $Ports) {
    if (@(Get-PidsOnPort $port).Count -gt 0) { $busy += $port }
}

if ($busy.Count -gt 0) {
    Write-Host "[IQVault] Still listening: $($busy -join ', '). Close those windows and retry." -ForegroundColor Yellow
    exit 1
}

Write-Host "[IQVault] Stopped. Postgres container is left running — 'docker stop iqvault-postgres' to also stop that." -ForegroundColor Green
Write-Host "[IQVault] Start again with Launch IQVault.bat (or the Desktop IQVault shortcut)." -ForegroundColor Green
