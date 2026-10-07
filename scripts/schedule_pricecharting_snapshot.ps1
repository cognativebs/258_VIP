# Register (or refresh) a daily Windows scheduled task for PriceCharting Phase B.
# 05:00 local (America/Chicago on this machine). Comics + Pokémon singles maps.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\schedule_pricecharting_snapshot.ps1
param(
    [string]$Time = "05:00",
    [string]$TaskName = "VIP PriceCharting Snapshot"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c npm run job:pricecharting-snapshot" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Nightly PriceCharting Phase B snapshot (comics + Pokemon singles). Time-series clock." -Force | Out-Null

Write-Host "[VIP] Registered '$TaskName' daily at $Time" -ForegroundColor Green
Write-Host "[VIP] Run now:    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "[VIP] Last result: Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "[VIP] Remove:     Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
