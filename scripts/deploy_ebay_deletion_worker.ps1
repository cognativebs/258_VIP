# Deploy the public eBay marketplace-deletion Worker.
# Do not click Save in the eBay portal until this script prints LIVE.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$workerDir = Join-Path $root "infra\ebay-deletion-worker"
$tokenFile = Join-Path $workerDir ".verification-token"

if (-not (Test-Path $workerDir)) {
    throw "Worker folder missing: $workerDir — pull cursor/ebay-comps-auth-058c first."
}

Set-Location $workerDir

if (-not (Test-Path $tokenFile)) {
    $chars = [char[]]((48..57) + (65..90) + (97..122) + 45 + 95)
    $token = -join (1..40 | ForEach-Object { $chars | Get-Random })
    Set-Content -Path $tokenFile -Value $token -NoNewline -Encoding ascii
    Write-Host "Wrote verification token to $tokenFile (gitignored). Do not paste it into chat."
} else {
    $token = (Get-Content -Path $tokenFile -Raw).Trim()
    Write-Host "Reusing verification token from $tokenFile"
}

if ($token.Length -lt 32 -or $token.Length -gt 80 -or $token -notmatch '^[A-Za-z0-9_-]+$') {
    throw "Token in $tokenFile is not 32-80 letters/numbers/-/_ — delete the file and re-run."
}

Write-Host "Logging into Cloudflare if needed (browser window)..."
npx --yes wrangler@4 whoami
if ($LASTEXITCODE -ne 0) {
    npx --yes wrangler@4 login
    if ($LASTEXITCODE -ne 0) { throw "wrangler login failed" }
}

Write-Host "Deploying vip-ebay-deletion..."
$deployOut = npx --yes wrangler@4 deploy 2>&1 | Out-String
Write-Host $deployOut
$match = [regex]::Match($deployOut, 'https://vip-ebay-deletion\.[A-Za-z0-9-]+\.workers\.dev')
if (-not $match.Success) {
    throw "Could not read workers.dev URL from wrangler output. Create a Cloudflare account first, then re-run."
}
$portalUrl = $match.Value.TrimEnd("/")

$token | npx --yes wrangler@4 secret put VERIFICATION_TOKEN
if ($LASTEXITCODE -ne 0) { throw "wrangler secret put failed" }

npx --yes wrangler@4 deploy --var "ENDPOINT_URL:$portalUrl"
if ($LASTEXITCODE -ne 0) { throw "wrangler deploy with ENDPOINT_URL failed" }

$health = Invoke-RestMethod $portalUrl
if (-not $health.configured) {
    throw "Worker is up but configured=false. Token secret may not have applied — re-run this script."
}

$apiEnv = Join-Path $root "services\api\.env"
if (Test-Path $apiEnv) {
    $envText = Get-Content $apiEnv -Raw
    if ($envText -notmatch 'EBAY_DELETION_ENDPOINT_URL=') {
        Add-Content $apiEnv "`nEBAY_DELETION_VERIFICATION_TOKEN=$token`nEBAY_DELETION_ENDPOINT_URL=$portalUrl`n"
        Write-Host "Appended deletion env to services\api\.env"
    }
}

Write-Host ""
Write-Host "LIVE. Do not add a trailing slash."
Write-Host "eBay endpoint URL:  $portalUrl"
Write-Host "Verification token: open $tokenFile (do not send it in chat)"
Write-Host "Then paste URL + token + your email in the eBay portal and click Save."
