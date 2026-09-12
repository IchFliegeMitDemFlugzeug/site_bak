param([string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '.release\migration-backend'))
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-package.ps1')
$Backend = Join-Path $Repo 'backend'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$Archive = Join-Path $OutputDirectory 'backend-initial.zip'
New-BackendArtifact -BackendSource $Backend -WorkingDirectory (Join-Path $OutputDirectory 'content') -ArchivePath $Archive | Out-Null
& npm.cmd test --prefix $Backend
if ($LASTEXITCODE -ne 0) { throw 'backend tests failed' }
Write-Host "PASS: $Archive"
