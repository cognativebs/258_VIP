# Recreate IQVault desktop shortcut with custom icon
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root "Launch IQVault.bat"
$icon = Join-Path $root "assets\iqvault-icon.ico"
$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "IQVault.lnk"

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $launcher
$sc.WorkingDirectory = $root
$sc.Description = "IQVault VIP - Docker, Postgres, Comics API, Orchestr8, UI"
$sc.IconLocation = "$icon,0"
$sc.WindowStyle = 1
$sc.Save()

Write-Host "Desktop shortcut updated: $lnk"
