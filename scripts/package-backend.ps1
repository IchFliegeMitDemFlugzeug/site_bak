param([string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '.release\migration-backend'))
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Repo 'backend'
& npm.cmd ci --prefix $Backend --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'backend npm ci failed' }
& npm.cmd test --prefix $Backend
if ($LASTEXITCODE -ne 0) { throw 'backend tests failed' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$stage = Join-Path $OutputDirectory 'content'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $stage | Out-Null
Copy-Item (Join-Path $Backend 'server.js'),(Join-Path $Backend 'package.json'),(Join-Path $Backend 'package-lock.json') $stage
Copy-Item (Join-Path $Backend 'node_modules') $stage -Recurse
$archive = Join-Path $OutputDirectory 'backend-initial.zip'
Remove-Item $archive -Force -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
Write-Host "PASS: $archive"
