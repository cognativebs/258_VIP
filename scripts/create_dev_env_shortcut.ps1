# Create Desktop shortcut for the Dev Environment launcher
param(
    [switch]$AlsoStartup
)

$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root "Start Dev Environment.bat"
$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "Dev Environment.lnk"

if (-not (Test-Path $launcher)) {
    throw "Missing launcher: $launcher"
}

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $launcher
$sc.WorkingDirectory = $root
$sc.Description = "Dev Environment - Cursor, Docker, VIP background tools"
$sc.WindowStyle = 1
# Prefer IQVault icon if present; otherwise default
$icon = Join-Path $root "assets\iqvault-icon.ico"
if (Test-Path $icon) {
    $sc.IconLocation = "$icon,0"
}
$sc.Save()

Write-Host "Desktop shortcut created: $lnk"

if ($AlsoStartup) {
    & (Join-Path $PSScriptRoot "start_dev_environment.ps1") -InstallStartup
}
