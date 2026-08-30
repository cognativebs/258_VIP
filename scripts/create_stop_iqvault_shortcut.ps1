# Recreate Desktop "Stop IQVault" shortcut with the stop icon.
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root "Stop IQVault.bat"
$icon = Join-Path $root "assets\iqvault-stop-icon.ico"
$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "Stop IQVault.lnk"

if (-not (Test-Path $launcher)) {
    throw "Missing stop launcher: $launcher"
}

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $launcher
$sc.WorkingDirectory = $root
$sc.Description = "Stop IQVault VIP services (API, Comics, Orchestr8, web, Binder). Postgres stays up."
if (Test-Path $icon) {
    $sc.IconLocation = "$icon,0"
}
$sc.WindowStyle = 1
$sc.Save()

Write-Host "Desktop shortcut updated: $lnk"
