# Register a daily 03:00 America/Chicago comics PriceCharting snapshot.
# Run once from an elevated PowerShell on the machine that stays on:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\schedule_comics_guide_snapshot.ps1
#
# Time is the PC clock. Set the PC to Central Time so 03:00 is CDT/CST.
param(
    [string]$Time = "03:00",
    [string]$TaskName = "VIP Comics Guide Snapshot"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c npm run job:comics-guide-snapshot" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings `
    -Description "Daily PriceCharting comics LIVE + SQL history (vendor_derived, not solds)" `
    -Force | Out-Null

Write-Host "[VIP] Registered '$TaskName' daily at $Time (use Central Time for CDT)" -ForegroundColor Green
Write-Host "[VIP] Run now:    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "[VIP] Last result: Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "[VIP] Remove:     Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
