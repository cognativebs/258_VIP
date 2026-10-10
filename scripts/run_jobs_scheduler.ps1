# Background jobs supervisor (started by the IQVault launcher in the "IQVault Jobs" window).
# Runs the jobs scheduler, appends everything it prints to scripts\logs\jobs.log, and starts it
# again 30 seconds after it exits for any reason, so feeds never stop silently.
param(
    [string]$Skip = "price-history",
    [string]$StateDir = ""
)

$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $PSScriptRoot "logs"
$Log = Join-Path $LogDir "jobs.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
if ($StateDir) { $env:VIP_JOBS_STATE_DIR = $StateDir }
Set-Location $Root

while ($true) {
    $started = Get-Date
    "[$($started.ToString('s'))] [supervisor] starting jobs scheduler (skip: $Skip)" | Tee-Object -FilePath $Log -Append
    & cmd.exe /c "npm run start -w @vip/jobs -- schedule --skip $Skip 2>&1" | Tee-Object -FilePath $Log -Append
    $code = $LASTEXITCODE
    "[$((Get-Date).ToString('s'))] [supervisor] scheduler exited (code $code) after $([int]((Get-Date) - $started).TotalMinutes) min - restarting in 30 s" | Tee-Object -FilePath $Log -Append
    Start-Sleep -Seconds 30
}
