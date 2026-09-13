param(
    [Parameter(Mandatory = $true)][string]$WorkerSource,
    [Parameter(Mandatory = $true)][string]$EnsureSource
)

# This script is intentionally the only one-time production bootstrap.  It does
# not configure IIS/backend: it only installs the request broker that later runs
# every reconcile under the already existing SYSTEM Scheduled Task.
$ErrorActionPreference = 'Stop'
$DeployRoot = 'C:\ProgramData\BTS\deploy'
$WorkerTarget = Join-Path $DeployRoot 'worker.ps1'
$EnsureTarget = Join-Path $DeployRoot 'ensure-production.ps1'
$TaskPath = '\bts\'
$TaskName = 'bts deploy worker'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]$identity
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this one-time worker bootstrap as Administrator on production.'
}
foreach ($source in @($WorkerSource,$EnsureSource)) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Bootstrap source is missing: $source" }
}
$task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction Stop
if ([string]$task.Principal.UserId -notmatch '^(SYSTEM|NT AUTHORITY\\SYSTEM)$') {
    throw 'The existing worker task must run as SYSTEM.'
}
$backup = "$WorkerTarget.before-v2-$(Get-Date -Format yyyyMMdd-HHmmss)"
if (Test-Path -LiteralPath $WorkerTarget) { Copy-Item -LiteralPath $WorkerTarget -Destination $backup }
Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
Copy-Item -LiteralPath $WorkerSource -Destination $WorkerTarget -Force
Copy-Item -LiteralPath $EnsureSource -Destination $EnsureTarget -Force
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WorkerTarget`""
Set-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Action $action | Out-Null
Enable-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName | Out-Null
Start-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
Write-Host "PASS: worker v2 request broker installed. Legacy backup: $backup"
