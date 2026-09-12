param([Parameter(Mandatory = $true)][string]$BackupRoot)
$ErrorActionPreference = 'Stop'
$appCmd = "$env:windir\system32\inetsrv\appcmd.exe"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator' }
if (-not (Test-Path $BackupRoot)) { throw 'Migration backup does not exist' }
Stop-Service BTSContactApi -Force -ErrorAction SilentlyContinue
$serviceExe = 'C:\ProgramData\BTS\contact-api\BTSContactApi.exe'
$metadata = Get-Content (Join-Path $BackupRoot 'migration.json') -Raw | ConvertFrom-Json
if (Test-Path $serviceExe -and -not [bool]$metadata.service_existed) { & $serviceExe uninstall }
if ([bool]$metadata.service_existed) {
    if (Test-Path (Join-Path $BackupRoot 'BTSContactApi.exe')) { Copy-Item (Join-Path $BackupRoot 'BTSContactApi.exe') $serviceExe -Force }
    if (Test-Path (Join-Path $BackupRoot 'BTSContactApi.xml')) { Copy-Item (Join-Path $BackupRoot 'BTSContactApi.xml') 'C:\ProgramData\BTS\contact-api\BTSContactApi.xml' -Force }
}
if (Test-Path 'C:\Sites\BTS\backend-current') { cmd.exe /d /c 'rmdir "C:\Sites\BTS\backend-current"' | Out-Null }
if ($metadata.backend_current) { cmd.exe /d /c "mklink /J `"C:\Sites\BTS\backend-current`" `"$($metadata.backend_current)`"" | Out-Null }
if (Test-Path (Join-Path $BackupRoot 'worker.ps1')) { Copy-Item (Join-Path $BackupRoot 'worker.ps1') 'C:\ProgramData\BTS\deploy\worker.ps1' -Force }
$stateRoot = 'C:\ProgramData\BTS\deploy\state'
foreach ($stateName in @('deployment-schema-version.txt','current-frontend-tree.txt','current-frontend-commit.txt','current-backend-tree.txt','current-backend-commit.txt','current-backend-release.txt')) {
    Remove-Item (Join-Path $stateRoot $stateName) -Force -ErrorAction SilentlyContinue
}
if (Test-Path (Join-Path $BackupRoot 'state')) { Copy-Item (Join-Path $BackupRoot 'state\*') $stateRoot -Recurse -Force }
$backupName = (Split-Path $BackupRoot -Leaf)
& $appCmd restore backup "BTS-before-two-component-$backupName" | Out-Null
if ([bool]$metadata.service_existed -and $metadata.service_status -eq 'Running') { Start-Service BTSContactApi }
Write-Host 'PASS: backend service removed; IIS, worker, junction and deployment state restored.'
