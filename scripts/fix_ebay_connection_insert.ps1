# One-time local patch: persist eBay scopes as ARRAY[$1,$2]::text[]
# Run from the repo root, then restart `npm run api`.
$path = Join-Path $PSScriptRoot "..\services\api\src\lib\ebaySell\store.ts"
$full = [System.IO.Path]::GetFullPath($path)
if (-not (Test-Path $full)) { throw "Not found: $full" }
$text = [System.IO.File]::ReadAllText($full)
$old = '${token.scopes}::text[]'
$new = 'ARRAY[${sql.join(token.scopes.map((s) => sql`${s}`), sql`, `)}]::text[]'
if ($text.Contains($old)) {
  $text = $text.Replace($old, $new)
  [System.IO.File]::WriteAllText($full, $text)
  Write-Host "Patched $full"
} elseif ($text.Contains("ARRAY[") -and $text.Contains("token.scopes")) {
  Write-Host "Already patched: $full"
} else {
  throw "Could not find token.scopes insert in $full"
}
