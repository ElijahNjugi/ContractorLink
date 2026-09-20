param([switch]$Stop, [switch]$NoBrowser, [switch]$UsePortableNode)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$runtime = Join-Path $root '.runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Fetch-Verified($Url, $Destination, $Sha256) {
    Write-Host "Downloading $([IO.Path]::GetFileName($Destination)) ..."
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -ne $Sha256) {
        throw 'Download checksum failed. The downloaded program was not executed. Try again.'
    }
}

$node = Join-Path $runtime 'node\node.exe'
if (-not (Test-Path -LiteralPath $node)) {
    $installed = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($installed -and -not $UsePortableNode) {
        $major = & $installed.Source -p 'process.versions.node.split(".")[0]'
        if ([int]$major -ge 22 -and [int]$major -le 24) { $node = $installed.Source }
    }
}
if ($Stop) {
    if (Test-Path -LiteralPath $node) { & $node (Join-Path $PSScriptRoot 'launch.mjs') --stop; exit $LASTEXITCODE }
    Write-Host 'ContractorLink is not running.'; exit 0
}

# A second click opens the already running app without reinstalling anything.
$stateFile = Join-Path $runtime 'instance.json'
if (Test-Path -LiteralPath $stateFile) {
    try {
        $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:$($state.controlPort)/status" -Headers @{Authorization="Bearer $($state.token)"} -TimeoutSec 2
        if ($status.ready -and $status.root -eq $root) {
            if (-not $NoBrowser) { Start-Process $status.url }
            Write-Host "Already running: $($status.url)"; exit 0
        }
    } catch { }
}

$setupLock = $null
try {
    try { $setupLock = [IO.File]::Open((Join-Path $runtime 'setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another ContractorLink launcher is setting up or running. Use its existing window and wait for setup to finish.' }
    Write-Host 'ContractorLink - local project launcher' -ForegroundColor Cyan
    Write-Host 'First setup needs internet. Your existing project database is not used.'
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'This launcher requires 64-bit Windows 10 or Windows 11.' }
    if (-not (Test-Path -LiteralPath $node)) {
        $base = 'https://nodejs.org/dist/latest-v22.x'
        $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
        $match = [regex]::Match($sums, '(?m)^([a-f0-9]{64})\s+(node-v[0-9.]+-win-x64\.zip)\s*$')
        if (-not $match.Success) { throw 'Could not locate the official Node.js Windows download checksum.' }
        $zip = Join-Path $runtime $match.Groups[2].Value
        Fetch-Verified "$base/$($match.Groups[2].Value)" $zip $match.Groups[1].Value
        Expand-Archive -LiteralPath $zip -DestinationPath $runtime -Force
        $unpacked = Join-Path $runtime ([IO.Path]::GetFileNameWithoutExtension($zip))
        # Both paths are fixed children of this project's runtime folder.
        Move-Item -LiteralPath $unpacked -Destination (Join-Path $runtime 'node')
        $node = Join-Path $runtime 'node\node.exe'
    }
    $env:PATH = (Split-Path -Parent $node) + ';' + $env:PATH
    $npm = Join-Path (Split-Path -Parent $node) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npm)) { throw 'The selected Node.js installation has no npm. Install a complete Node.js LTS distribution and retry.' }
    $lockHash = (Get-FileHash (Join-Path $root 'package-lock.json')).Hash
    $stamp = Join-Path $runtime 'launcher-dependencies.txt'
    if (-not (Test-Path 'node_modules/embedded-postgres') -or -not (Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $lockHash) {
        Write-Host 'Installing the portable database runtime ...'
        & $node $npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Database dependency installation failed. Check your internet connection and retry.' }
        Set-Content $stamp $lockHash
    }

    $uv = Join-Path $runtime 'uv\uv.exe'
    $python = Join-Path $runtime 'venv\Scripts\python.exe'
    $requirements = Join-Path $root 'ml\requirements-launcher.txt'
    $pyHash = (Get-FileHash $requirements).Hash
    $pyStamp = Join-Path $runtime 'python-dependencies.txt'
    if (-not (Test-Path $python) -or -not (Test-Path $pyStamp) -or (Get-Content $pyStamp -Raw).Trim() -ne $pyHash) {
        if (-not (Test-Path $uv)) {
            $uvZip = Join-Path $runtime 'uv.zip'
            Fetch-Verified 'https://github.com/astral-sh/uv/releases/download/0.12.17/uv-x86_64-pc-windows-msvc.zip' $uvZip 'a252121d5b59398fcb137c6ea448176459a44010f33f67e0072305a637119ca7'
            Expand-Archive -LiteralPath $uvZip -DestinationPath (Join-Path $runtime 'uv') -Force
        }
        $env:UV_PYTHON_INSTALL_DIR = Join-Path $runtime 'python'
        $env:UV_CACHE_DIR = Join-Path $runtime 'uv-cache'
        if (-not (Test-Path $python)) {
            Write-Host 'Setting up project-local Python 3.12 ...'
            & $uv venv --python 3.12 --managed-python (Join-Path $runtime 'venv')
            if ($LASTEXITCODE -ne 0) { throw 'Python setup failed. Check internet access and retry.' }
        }
        & $uv pip install --python $python -r $requirements
        if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed. Check internet access and retry.' }
        Set-Content $pyStamp $pyHash
    }
    $env:PYTHON_EXECUTABLE = $python
    $env:CONTRACTORLINK_NPM_CLI = $npm
    if ($NoBrowser) { & $node (Join-Path $PSScriptRoot 'launch.mjs') --no-browser }
    else { & $node (Join-Path $PSScriptRoot 'launch.mjs') }
    if ($LASTEXITCODE -ne 0) { throw 'ContractorLink stopped with an error. See .runtime\logs for details.' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    if ($setupLock) { $setupLock.Dispose() }
}
