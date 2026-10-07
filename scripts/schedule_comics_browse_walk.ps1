# Register (or refresh) a daily Windows scheduled task for the comics eBay Browse walk.
# 05:30 local, after the 05:00 PriceCharting snapshot. All publishers. Resumable.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\schedule_comics_browse_walk.ps1
param(
    [string]$Time = "05:30",
    [string]$TaskName = "VIP Comics Browse Walk"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c npm run job:comics-comps -- --publishers=all --resume" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Nightly eBay Browse inventory walk (all comic holdings). Rate-limited, resumable, idempotent per day." -Force | Out-Null

Write-Host "[VIP] Registered '$TaskName' daily at $Time" -ForegroundColor Green
Write-Host "[VIP] Daily ceiling: 5000 Browse searches (VIP_EBAY_DAILY_CALL_CEILING). Vault is ~2700 holdings."
Write-Host "[VIP] Run now:    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "[VIP] Last result: Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "[VIP] Remove:     Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
