# Dev environment launcher - post-restart apps for AI / Cursor / VS Code / VIP tools
# Config: scripts/dev-environment.json
# Shortcut: Start Dev Environment.bat  or  Desktop "Dev Environment.lnk"
param(
    [switch]$All,
    [switch]$AppsOnly,
    [switch]$ServicesOnly,
    [switch]$NoMenu,
    [switch]$InstallStartup,
    [switch]$RemoveStartup
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $PSScriptRoot "dev-environment.json"
$StartupLnkName = "Dev Environment.lnk"

function Expand-EnvPath([string]$Path) {
    return [Environment]::ExpandEnvironmentVariables($Path)
}

function Get-Config {
    if (-not (Test-Path $ConfigPath)) {
        throw "Missing config: $ConfigPath"
    }
    return Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
}

function Write-Banner {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Dev Environment - post-restart" -ForegroundColor Green
    Write-Host "  IQVault / Cursor / background tools" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
}

function Write-Step([string]$Msg) {
    Write-Host "[dev-env] $Msg" -ForegroundColor Cyan
}

function Test-ProcessRunning([string]$ProcessName) {
    if ([string]::IsNullOrWhiteSpace($ProcessName)) { return $false }
    return $null -ne (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Test-PortListening([int]$Port) {
    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
    } catch {
        return $false
    }
}

function Get-AppStatus($App) {
    $path = Expand-EnvPath $App.path
    $exists = Test-Path $path
    $running = if ($App.processName) { Test-ProcessRunning $App.processName } else { $false }
    return [pscustomobject]@{
        Id       = $App.id
        Name     = $App.name
        Enabled  = [bool]$App.enabled
        Exists   = $exists
        Running  = $running
        Path     = $path
        Group    = $App.group
        Notes    = $App.notes
        Kind     = "app"
        Raw      = $App
    }
}

function Get-ServiceStatus($Svc) {
    $kind = if ($Svc.kind) { [string]$Svc.kind } else { "powershell" }
    $path = if ($kind -eq "npm" -or $kind -eq "cmd") {
        $Root
    } elseif ($Svc.script) {
        Join-Path $Root $Svc.script
    } else {
        $Root
    }
    $exists = if ($kind -eq "npm" -or $kind -eq "cmd") { $true } else { Test-Path $path }
    $running = $false
    if ($Svc.port) {
        $running = Test-PortListening ([int]$Svc.port)
    }

    return [pscustomobject]@{
        Id      = $Svc.id
        Name    = $Svc.name
        Enabled = [bool]$Svc.enabled
        Exists  = $exists
        Running = $running
        Path    = $path
        Group   = $Svc.group
        Notes   = $Svc.notes
        Kind    = "service"
        Raw     = $Svc
    }
}

function Show-Inventory($Config) {
    Write-Host "Configured items  (edit: scripts\dev-environment.json)" -ForegroundColor DarkGray
    Write-Host ""
    $rows = @()
    foreach ($app in $Config.apps) { $rows += Get-AppStatus $app }
    foreach ($svc in $Config.services) { $rows += Get-ServiceStatus $svc }

    $i = 1
    foreach ($r in $rows) {
        $en = if ($r.Enabled) { "ON " } else { "off" }
        $st = if (-not $r.Exists) { "MISSING" } elseif ($r.Running) { "running" } else { "stopped" }
        $color = if (-not $r.Exists) { "Red" } elseif ($r.Running) { "Green" } elseif ($r.Enabled) { "Yellow" } else { "DarkGray" }
        Write-Host ("  [{0,2}] {1,-3}  {2,-28} {3,-8}  {4}" -f $i, $en, $r.Name, $st, $r.Group) -ForegroundColor $color
        if ($r.Notes) {
            Write-Host ("         {0}" -f $r.Notes) -ForegroundColor DarkGray
        }
        $i++
    }
    Write-Host ""
    return $rows
}

function Start-ConfiguredApp($App) {
    $path = Expand-EnvPath $App.path
    if (-not (Test-Path $path)) {
        Write-Host "[dev-env] SKIP (not installed): $($App.name) -> $path" -ForegroundColor Yellow
        return
    }
    if ($App.processName -and (Test-ProcessRunning $App.processName)) {
        Write-Step "$($App.name) already running."
        return
    }

    $style = if ($App.windowStyle) { $App.windowStyle } else { "Normal" }
    $args = @()
    if ($App.args) { $args = @($App.args) }

    Write-Step "Starting $($App.name)..."
    if ($args.Count -gt 0) {
        Start-Process -FilePath $path -ArgumentList $args -WindowStyle $style | Out-Null
    } else {
        Start-Process -FilePath $path -WindowStyle $style | Out-Null
    }

    if ($App.waitSeconds -and [int]$App.waitSeconds -gt 0) {
        Start-Sleep -Seconds ([int]$App.waitSeconds)
    }
}

function Start-ConfiguredService($Svc) {
    $kind = if ($Svc.kind) { [string]$Svc.kind } else { "powershell" }

    if ($Svc.port -and (Test-PortListening ([int]$Svc.port))) {
        Write-Step "$($Svc.name) already on port $($Svc.port)."
        return
    }

    Write-Step "Starting service: $($Svc.name)..."

    if ($kind -eq "npm") {
        $npmScript = [string]$Svc.npmScript
        if ([string]::IsNullOrWhiteSpace($npmScript)) {
            Write-Host "[dev-env] SKIP (npmScript missing): $($Svc.name)" -ForegroundColor Yellow
            return
        }
        $title = if ($Svc.name) { $Svc.name } else { $Svc.id }
        $arg = "/k title $title && cd /d `"$Root`" && npm run $npmScript"
        Start-Process -FilePath "cmd.exe" -ArgumentList $arg -WorkingDirectory $Root -WindowStyle Minimized | Out-Null
        return
    }

    if ($kind -eq "cmd") {
        $command = [string]$Svc.command
        if ([string]::IsNullOrWhiteSpace($command)) {
            Write-Host "[dev-env] SKIP (command missing): $($Svc.name)" -ForegroundColor Yellow
            return
        }
        $title = if ($Svc.name) { $Svc.name } else { $Svc.id }
        $arg = "/k title $title && cd /d `"$Root`" && $command"
        Start-Process -FilePath "cmd.exe" -ArgumentList $arg -WorkingDirectory $Root -WindowStyle Minimized | Out-Null
        return
    }

    $scriptPath = Join-Path $Root $Svc.script
    if (-not (Test-Path $scriptPath)) {
        Write-Host "[dev-env] SKIP (script missing): $($Svc.name) -> $scriptPath" -ForegroundColor Yellow
        return
    }

    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath)
    if ($Svc.args) { $argList += @($Svc.args) }

    # Separate minimized window so this menu stays usable
    Start-Process -FilePath "powershell.exe" -ArgumentList $argList -WorkingDirectory $Root -WindowStyle Minimized | Out-Null
}

function Start-EnabledApps($Config) {
    foreach ($app in $Config.apps) {
        if ($app.enabled) { Start-ConfiguredApp $app }
    }
}

function Start-EnabledServices($Config) {
    foreach ($svc in $Config.services) {
        if ($svc.enabled) { Start-ConfiguredService $svc }
    }
}

function Open-Config {
    Write-Step "Opening config in default editor..."
    Start-Process $ConfigPath
}

function Get-StartupShortcutPath {
    $startup = [Environment]::GetFolderPath("Startup")
    return Join-Path $startup $StartupLnkName
}

function Install-StartupShortcut {
    $bat = Join-Path $Root "Start Dev Environment.bat"
    if (-not (Test-Path $bat)) {
        throw "Missing launcher: $bat"
    }
    $lnkPath = Get-StartupShortcutPath
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnkPath)
    $sc.TargetPath = $bat
    $sc.Arguments = "-All -NoMenu"
    $sc.WorkingDirectory = $Root
    $sc.Description = "Auto-start Dev Environment apps after login"
    $sc.WindowStyle = 7  # minimized
    $sc.Save()
    Write-Step "Installed Windows Startup shortcut: $lnkPath"
    Write-Host "  (runs quietly with -All -NoMenu after each login/restart)" -ForegroundColor DarkGray
}

function Remove-StartupShortcut {
    $lnkPath = Get-StartupShortcutPath
    if (Test-Path $lnkPath) {
        Remove-Item $lnkPath -Force
        Write-Step "Removed Startup shortcut: $lnkPath"
    } else {
        Write-Step "No Startup shortcut present."
    }
}

function Show-Menu($Config) {
    while ($true) {
        Clear-Host
        Write-Banner
        $null = Show-Inventory $Config
        Write-Host "Actions:" -ForegroundColor White
        Write-Host "  [A] Start all enabled (apps + services)"
        Write-Host "  [P] Start apps only (Cursor, Docker, Terminal, ...)"
        Write-Host "  [S] Start services only (IQVault stack)"
        Write-Host "  [1-9] Start one item by number"
        Write-Host "  [E] Edit list (dev-environment.json)"
        Write-Host "  [I] Install to Windows Startup (auto after restart)"
        Write-Host "  [U] Uninstall from Windows Startup"
        Write-Host "  [R] Refresh status"
        Write-Host "  [Q] Quit"
        Write-Host ""
        $choice = Read-Host "Choice"

        switch -Regex ($choice.Trim().ToUpperInvariant()) {
            '^A$' {
                Start-EnabledApps $Config
                Start-EnabledServices $Config
                Write-Host ""
                Write-Step "Done. Background windows may still be warming up."
                Read-Host "Press Enter"
            }
            '^P$' {
                Start-EnabledApps $Config
                Write-Host ""
                Write-Step "Apps started."
                Read-Host "Press Enter"
            }
            '^S$' {
                Start-EnabledServices $Config
                Write-Host ""
                Write-Step "Services launching in minimized windows."
                Read-Host "Press Enter"
            }
            '^E$' { Open-Config; Read-Host "Press Enter after saving" ; $Config = Get-Config }
            '^I$' { Install-StartupShortcut; Read-Host "Press Enter" }
            '^U$' { Remove-StartupShortcut; Read-Host "Press Enter" }
            '^R$' { $Config = Get-Config }
            '^Q$' { return }
            '^\d+$' {
                $rows = @()
                foreach ($app in $Config.apps) { $rows += Get-AppStatus $app }
                foreach ($svc in $Config.services) { $rows += Get-ServiceStatus $svc }
                $idx = [int]$choice - 1
                if ($idx -lt 0 -or $idx -ge $rows.Count) {
                    Write-Host "Invalid number." -ForegroundColor Red
                    Start-Sleep -Seconds 1
                    continue
                }
                $item = $rows[$idx]
                if ($item.Kind -eq "app") { Start-ConfiguredApp $item.Raw }
                else { Start-ConfiguredService $item.Raw }
                Read-Host "Press Enter"
            }
            default {
                Write-Host "Unknown choice." -ForegroundColor Yellow
                Start-Sleep -Seconds 1
            }
        }
        $Config = Get-Config
    }
}

# --- main ---
if ($InstallStartup) {
    Write-Banner
    Install-StartupShortcut
    exit 0
}
if ($RemoveStartup) {
    Write-Banner
    Remove-StartupShortcut
    exit 0
}

$Config = Get-Config
Write-Banner

if ($All -or $AppsOnly -or $ServicesOnly) {
    $null = Show-Inventory $Config
    if ($All) {
        Start-EnabledApps $Config
        Start-EnabledServices $Config
    } elseif ($AppsOnly) {
        Start-EnabledApps $Config
    } else {
        Start-EnabledServices $Config
    }
    Write-Host ""
    Write-Step "Finished non-interactive start."
    if (-not $NoMenu) {
        Read-Host "Press Enter to close"
    }
    exit 0
}

Show-Menu $Config
