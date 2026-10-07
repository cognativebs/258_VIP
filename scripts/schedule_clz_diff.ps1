# Register a daily Windows task that watches data/imports/clz/ and reports a DIFF.
# Does not apply. Confirmation required: python scripts/clz_diff.py --apply --xml <snapshot>
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/schedule_clz_diff.ps1
param(
    [string]$Time = "06:00",
    [string]$TaskName = "VIP CLZ Diff Watch"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c npm run job:clz-diff" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Nightly CLZ DIFF watch of data/imports/clz. Report only; wait to apply." -Force | Out-Null

Write-Host "[VIP] Registered '$TaskName' daily at $Time" -ForegroundColor Green
Write-Host "[VIP] Drop an export in data/imports/clz/ then wait for the report."
Write-Host "[VIP] Apply only after confirmation: python scripts/clz_diff.py --apply --xml <snapshot>"
