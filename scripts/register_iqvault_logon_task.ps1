# Register (or refresh) a Windows scheduled task that starts the IQVault stack when you log on
# (operator decision 2026-10-17: a Windows Update restart on 2026-10-14 stopped every feed for 3 days).
# The stack starts 2 minutes after logon, with no browser, from -Root (default: this checkout).
# The jobs scheduler then catches up: hourly feeds run at once and the daily brief runs if it is due.
# -PullFirst (default on) fast-forwards the checkout before launching, so a PR merged to main goes live
# at the next logon; a checkout that cannot fast-forward is left as it is and still starts.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register_iqvault_logon_task.ps1
#   ... -Root D:\Projects\Business_Ideas\258_Labs\258_VIP-signals-spine   (the production runner)
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$TaskName = "VIP IQVault Stack at Logon",
    [int]$DelayMinutes = 2,
    [bool]$PullFirst = $true
)

$ErrorActionPreference = "Stop"
$Launcher = Join-Path $Root "scripts\start_iqvault_ecosystem.ps1"
if (-not (Test-Path $Launcher)) { throw "Launcher not found: $Launcher" }

$launch = "& '$Launcher' -NoBrowser"
if ($PullFirst) { $launch = "git -C '$Root' pull --ff-only 2>&1 | Out-Host; $launch" }
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$launch`"" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = "PT$($DelayMinutes)M"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

# Runs as you, only while you are logged on (no stored password), at normal privilege.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "Starts Docker/Postgres, VIP API, Comics API, Orchestr8, web and the jobs scheduler from $Root after logon." -Force | Out-Null

Write-Host "[VIP] Registered '$TaskName' (at logon + $DelayMinutes min, pull first: $PullFirst) for $Root" -ForegroundColor Green
Write-Host "[VIP] Run now:     Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "[VIP] Last result: Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "[VIP] Remove:      Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
