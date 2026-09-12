param([Parameter(Mandatory = $true)][string]$BackupRoot)
$ErrorActionPreference = 'Stop'
$appCmd = "$env:windir\system32\inetsrv\appcmd.exe"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator' }
if (-not (Test-Path $BackupRoot)) { throw 'Migration backup does not exist' }
Stop-Service BTSContactApi -Force -ErrorAction SilentlyContinue
$serviceExe = 'C:\ProgramData\BTS\contact-api\BTSContactApi.exe'
if (Test-Path $serviceExe) { & $serviceExe uninstall }
$metadata = Get-Content (Join-Path $BackupRoot 'migration.json') -Raw | ConvertFrom-Json
if (Test-Path 'C:\Sites\BTS\backend-current') { cmd.exe /d /c 'rmdir "C:\Sites\BTS\backend-current"' | Out-Null }
if ($metadata.backend_current) { cmd.exe /d /c "mklink /J `"C:\Sites\BTS\backend-current`" `"$($metadata.backend_current)`"" | Out-Null }
if (Test-Path (Join-Path $BackupRoot 'worker.ps1')) { Copy-Item (Join-Path $BackupRoot 'worker.ps1') 'C:\ProgramData\BTS\deploy\worker.ps1' -Force }
if (Test-Path (Join-Path $BackupRoot 'state')) { Copy-Item (Join-Path $BackupRoot 'state\*') 'C:\ProgramData\BTS\deploy\state' -Recurse -Force }
$backupName = (Split-Path $BackupRoot -Leaf)
& $appCmd restore backup "BTS-before-two-component-$backupName" | Out-Null
Write-Host 'PASS: backend service removed; IIS, worker, junction and deployment state restored.'
