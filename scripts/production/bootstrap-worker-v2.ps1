param(
    [Parameter(Mandatory = $true)][string]$WorkerSource,
    [Parameter(Mandatory = $true)][string]$EnsureSource,
    [Parameter(Mandatory = $true)][string]$ServiceConfigSource,
    [Parameter(Mandatory = $true)][string]$WinSWSource
)

# This script is intentionally the only one-time production bootstrap.  It does
# not configure IIS/backend: it only installs the request broker that later runs
# every reconcile under the already existing SYSTEM Scheduled Task.
$ErrorActionPreference = 'Stop'
$DeployRoot = 'C:\ProgramData\BTS\deploy'
$TrustedRoot = Join-Path $DeployRoot 'trusted'
$WorkerTarget = Join-Path $TrustedRoot 'worker.ps1'
$EnsureTarget = Join-Path $TrustedRoot 'ensure-production.ps1'
$ServiceConfigTarget = Join-Path $TrustedRoot 'BTS.ContactApi.xml'
$WinSWTarget = Join-Path $TrustedRoot 'WinSW-x64.exe'
$LegacyWorker = Join-Path $DeployRoot 'worker.ps1'
$TaskPath = '\bts\'
$TaskName = 'bts deploy worker'

function Invoke-Icacls {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & icacls.exe @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed: $($Arguments -join ' ')" }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]$identity
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this one-time worker bootstrap as Administrator on production.'
}
foreach ($source in @($WorkerSource,$EnsureSource,$ServiceConfigSource,$WinSWSource)) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Bootstrap source is missing: $source" }
}
$winSWSignature = Get-AuthenticodeSignature -FilePath $WinSWSource
if ($winSWSignature.Status -ne 'Valid') { throw "WinSW Authenticode signature is not valid: $($winSWSignature.Status)" }
[xml]$serviceConfig = Get-Content -LiteralPath $ServiceConfigSource -Raw
if ($serviceConfig.service.id -ne 'BTSContactApi') { throw 'Unexpected WinSW service configuration.' }
$task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction Stop
if ([string]$task.Principal.UserId -notmatch '^(SYSTEM|NT AUTHORITY\\SYSTEM)$') {
    throw 'The existing worker task must run as SYSTEM.'
}
$backup = "$LegacyWorker.before-v2-$(Get-Date -Format yyyyMMdd-HHmmss)"
if (Test-Path -LiteralPath $LegacyWorker) { Copy-Item -LiteralPath $LegacyWorker -Destination $backup }
Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $TrustedRoot -Force | Out-Null
# Remove inherited permissions before copying executable content.  Only the
# well-known SYSTEM and local Administrators SIDs retain access; bts-deploy is
# explicitly removed and receives no write/modify grant anywhere in this script.
Invoke-Icacls -Arguments @($TrustedRoot,'/inheritance:r')
Invoke-Icacls -Arguments @($TrustedRoot,'/grant:r','*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F')
Invoke-Icacls -Arguments @($TrustedRoot,'/remove:g','bts-deploy')
Copy-Item -LiteralPath $WorkerSource -Destination $WorkerTarget -Force
Copy-Item -LiteralPath $EnsureSource -Destination $EnsureTarget -Force
Copy-Item -LiteralPath $ServiceConfigSource -Destination $ServiceConfigTarget -Force
Copy-Item -LiteralPath $WinSWSource -Destination $WinSWTarget -Force
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WorkerTarget`""
Set-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Action $action | Out-Null
Enable-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName | Out-Null
Start-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
Write-Host "PASS: trusted worker broker installed. Legacy backup: $backup"
