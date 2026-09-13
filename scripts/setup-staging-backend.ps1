param([string]$EnvironmentFile)

$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Repo 'backend'

if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
    $EnvironmentFile = Join-Path $Backend '.env'
}

if (-not (Test-Path $EnvironmentFile)) {
    throw "Staging environment file missing: $EnvironmentFile"
}

Get-Content $EnvironmentFile |
    Where-Object { $_ -match '^[A-Z_]+=' } |
    ForEach-Object {
        $name, $value = $_ -split '=', 2
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }

$env:Path =
    [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [Environment]::GetEnvironmentVariable('Path', 'User')

$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) {
    throw 'npm.cmd not found'
}

$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue

if ($NodeCommand) {
    $NodePath = $NodeCommand.Source
}
elseif (Test-Path 'C:\Program Files\nodejs\node.exe') {
    $NodePath = 'C:\Program Files\nodejs\node.exe'
}
else {
    throw 'node.exe not found'
}

& $NpmCommand.Source ci --prefix $Backend --omit=dev
if ($LASTEXITCODE -ne 0) {
    throw "backend npm ci failed: $LASTEXITCODE"
}

Write-Host "Node: $NodePath"
Write-Host 'Starting BTS staging contact API...'

& $NodePath (Join-Path $Backend 'start.js')

if ($LASTEXITCODE -ne 0) {
    throw "backend exited with code: $LASTEXITCODE"
}