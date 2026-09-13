param([string]$EnvironmentFile = 'C:\ProgramData\BTS\staging-contact-api.env')
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path $EnvironmentFile)) { throw "Staging environment file missing: $EnvironmentFile" }
Get-Content $EnvironmentFile | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $name,$value = $_ -split '=',2; [Environment]::SetEnvironmentVariable($name,$value,'Process') }
& npm.cmd ci --prefix (Join-Path $Repo 'backend') --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'backend npm ci failed' }
& node.exe (Join-Path $Repo 'backend\server.js')
