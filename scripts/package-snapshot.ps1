$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
if (-not (Test-Path 'snapshot/manifest.json')) { throw 'Run node scripts/export-snapshot.mjs first.' }
$package = Get-Content '.distribution/latest-package.json' -Raw | ConvertFrom-Json
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$handover = Join-Path $root ".distribution/private-$stamp/ContractorLink"
New-Item -ItemType Directory -Force -Path $handover | Out-Null
foreach ($relative in $package.files) {
    $target = Join-Path $handover $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $relative) -Destination $target
}
# Include newly added public files even when the source release predates them.
foreach ($folder in @('scripts','notebooks')) {
    Copy-Item -LiteralPath (Join-Path $root $folder) -Destination $handover -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $root 'snapshot') -Destination $handover -Recurse
$zip = Join-Path $root '.distribution/ContractorLink-With-Records.zip'
Compress-Archive -LiteralPath $handover -DestinationPath $zip -Force
Write-Output $zip
Write-Output "Private snapshot edition. Share directly; do not upload this ZIP to the public repository."
