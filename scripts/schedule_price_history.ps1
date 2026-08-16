# Register (or refresh) a daily Windows scheduled task for card price history.
# Run once from an elevated PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\schedule_price_history.ps1
#
# The task runs as the current user at the given time and catches up on the next
# opportunity if the machine was asleep, so a missed day still gets collected.
param(
    [string]$Time = "06:00",
    [string]$TaskName = "VIP Card Price History"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Bat = Join-Path $Root "Update Card Prices.bat"

if (-not (Test-Path $Bat)) {
    throw "Not found: $Bat"
}

# cmd /c so the .bat's own pause is skipped in unattended runs.
$action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c npm run job:price-history" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Daily TCGplayer price history for VIP (NM)" -Force | Out-Null

Write-Host "[VIP] Registered '$TaskName' daily at $Time" -ForegroundColor Green
Write-Host "[VIP] Run now:    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "[VIP] Last result: Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "[VIP] Remove:     Unregister-ScheduledTask -TaskName '$TaskName'"
