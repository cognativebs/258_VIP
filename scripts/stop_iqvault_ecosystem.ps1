# Stop every IQVault VIP service window (does not stop Postgres/Docker).
$Ports = 8787, 5200, 5210, 3000, 3010

foreach ($port in $Ports) {
    $procIds = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
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
