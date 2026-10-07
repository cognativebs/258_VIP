# Starts VaultOS demo on LAN so iPhone on same Wi-Fi can connect.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$demo = Join-Path $root "demo"

function Get-LanIp {
  $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Sort-Object -Property InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress
  if (-not $addr) {
    throw "No LAN IPv4 address found. Connect to Wi-Fi and retry."
  }
  return $addr
}

Set-Location $demo
if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
}

$ip = Get-LanIp
$port = 5174
$url = "http://${ip}:${port}"
$envFile = Join-Path $demo ".env.local"
"VITE_MOBILE_URL=$url" | Set-Content -Path $envFile -Encoding utf8

Write-Host ""
Write-Host "  VaultOS Demo - Mobile ready" -ForegroundColor Green
Write-Host "  PC:     http://127.0.0.1:${port}"
Write-Host "  iPhone: $url  (same Wi-Fi)"
Write-Host ""
Write-Host "  On iPhone: Safari -> Acquire -> Photo Library or Take Photo"
Write-Host ""

Set-Location $demo
npm run dev
