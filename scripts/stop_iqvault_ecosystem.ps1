# Stop every IQVault VIP service window (does not stop Postgres/Docker).
$Ports = 8787, 5200, 5210, 3000, 3010

function Get-PidsOnPort([int]$Port) {
    $ids = @()
    try {
        $ids = @(
            Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
        )
    } catch {}
    if (-not $ids -or @($ids).Count -eq 0) {
        try {
            foreach ($line in (netstat -ano)) {
                if ($line -notmatch "LISTENING") { continue }
                if ($line -notmatch ":$Port\s") { continue }
                $parts = ($line.Trim() -split "\s+")
                $procId = $parts[-1]
                if ($procId -match "^\d+$") { $ids += [int]$procId }
            }
            $ids = @($ids | Select-Object -Unique)
        } catch {}
    }
    return @($ids)
}

foreach ($port in $Ports) {
    $procIds = Get-PidsOnPort $port
    foreach ($procId in $procIds) {
        try {
            $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
            Write-Host "[IQVault] Stopping port $port (pid $procId, $name)" -ForegroundColor Cyan
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        } catch {
            # already gone
        }
    }
}

Write-Host "[IQVault] Stopped. Postgres container is left running - 'docker stop iqvault-postgres' to also stop that." -ForegroundColor Green
