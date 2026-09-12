param(
    [Parameter(Mandatory = $true)][string]$InitialBackendZip,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$InitialBackendTree,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$InitialBackendCommit,
    [Parameter(Mandatory = $true)][string]$WinSWExe,
    [string]$WorkerSource = (Join-Path $PSScriptRoot 'worker-v2.ps1')
)
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = "C:\ProgramData\BTS\migration-backups\$stamp"
$deployRoot = 'C:\ProgramData\BTS\deploy'
$state = Join-Path $deployRoot 'state'
$workerTarget = Join-Path $deployRoot 'worker.ps1'
$backendReleases = 'C:\Sites\BTS\backend-releases'
$backendCurrent = 'C:\Sites\BTS\backend-current'
$serviceRoot = 'C:\ProgramData\BTS\contact-api'
$serviceExe = Join-Path $serviceRoot 'BTSContactApi.exe'
$serviceXml = Join-Path $serviceRoot 'BTSContactApi.xml'
$appCmd = "$env:windir\system32\inetsrv\appcmd.exe"
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator' }
if (-not (Test-Path $appCmd)) { throw 'IIS is not installed' }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js runtime is required' }
if (-not (Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite')) { throw 'IIS URL Rewrite is required' }
try { Get-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -ErrorAction Stop | Out-Null } catch { throw 'IIS Application Request Routing is required' }
foreach ($path in @($InitialBackendZip,$WinSWExe,$WorkerSource)) { if (-not (Test-Path $path)) { throw "Required file missing: $path" } }
if (-not [Environment]::GetEnvironmentVariable('SMTP_PASS','Machine')) { throw 'Machine environment variable SMTP_PASS is required' }

New-Item -ItemType Directory -Force -Path $backupRoot,$backendReleases,$serviceRoot,(Join-Path $serviceRoot 'logs'),$state,(Join-Path $deployRoot 'incoming'),(Join-Path $deployRoot 'outbox') | Out-Null
& $appCmd add backup "BTS-before-two-component-$stamp" | Out-Null
if (Test-Path $workerTarget) { Copy-Item $workerTarget (Join-Path $backupRoot 'worker.ps1') }
if (Test-Path $state) { Copy-Item $state (Join-Path $backupRoot 'state') -Recurse }
& $appCmd list config 'BTS' /section:system.webServer/rewrite /xml | Set-Content (Join-Path $backupRoot 'iis-bts-rewrite.xml') -Encoding UTF8
[IO.File]::WriteAllText((Join-Path $backupRoot 'migration.json'), (@{ stamp=$stamp; backend_current=if(Test-Path $backendCurrent){(Get-Item $backendCurrent).Target}else{''} } | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))

$initialRelease = Join-Path $backendReleases "${stamp}_migration"
if (-not (Test-Path $initialRelease)) { Expand-Archive $InitialBackendZip $initialRelease }
if (-not (Test-Path (Join-Path $initialRelease 'server.js')) -or -not (Test-Path (Join-Path $initialRelease 'node_modules'))) { throw 'Initial backend ZIP is incomplete' }
if (Test-Path $backendCurrent) { cmd.exe /d /c "rmdir `"$backendCurrent`"" | Out-Null }
cmd.exe /d /c "mklink /J `"$backendCurrent`" `"$initialRelease`"" | Out-Null

Copy-Item $WinSWExe $serviceExe -Force
$nodePath = (Get-Command node.exe).Source
(Get-Content (Join-Path $repoRoot 'backend\config\BTS.ContactApi.xml') -Raw).Replace('C:\Program Files\nodejs\node.exe',$nodePath) | Set-Content $serviceXml -Encoding UTF8
if (-not (Get-Service BTSContactApi -ErrorAction SilentlyContinue)) { & $serviceExe install }

Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled -Value true
$site = 'BTS'
if (-not (Test-Path "IIS:\Sites\$site")) { throw 'IIS site BTS is missing' }
    $filter = 'system.webServer/rewrite/rules'
    $existing = Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $site -Filter "$filter/rule[@name='BTS API reverse proxy']" -Name '.' -ErrorAction SilentlyContinue
    if (-not $existing) {
        Add-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $site -Filter $filter -Name '.' -Value @{name='BTS API reverse proxy';patternSyntax='ECMAScript';stopProcessing='True'}
        Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $site -Filter "$filter/rule[@name='BTS API reverse proxy']/match" -Name url -Value '^api/(.*)$'
        Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $site -Filter "$filter/rule[@name='BTS API reverse proxy']/action" -Name type -Value Rewrite
        Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $site -Filter "$filter/rule[@name='BTS API reverse proxy']/action" -Name url -Value 'http://127.0.0.1:3001/api/{R:1}'
}

Copy-Item $WorkerSource $workerTarget -Force
$incomingAcl = Get-Acl (Join-Path $deployRoot 'incoming')
$incomingRule = New-Object Security.AccessControl.FileSystemAccessRule('bts-deploy','Modify','ContainerInherit,ObjectInherit','None','Allow')
$incomingAcl.SetAccessRule($incomingRule)
Set-Acl (Join-Path $deployRoot 'incoming') $incomingAcl
$outboxAcl = Get-Acl (Join-Path $deployRoot 'outbox')
$outboxRule = New-Object Security.AccessControl.FileSystemAccessRule('bts-deploy','ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')
$outboxAcl.SetAccessRule($outboxRule)
Set-Acl (Join-Path $deployRoot 'outbox') $outboxAcl
Start-Service BTSContactApi
$health = & curl.exe -fsS 'http://127.0.0.1:3001/api/health'
if ($LASTEXITCODE -ne 0 -or (($health | Out-String).Trim() -ne '{"ok":true}')) { throw "Backend health failed. Run rollback-migration.ps1 -BackupRoot '$backupRoot'" }
Set-Content (Join-Path $state 'current-backend-release.txt') $initialRelease -NoNewline
Set-Content (Join-Path $state 'current-backend-tree.txt') $InitialBackendTree -NoNewline
Set-Content (Join-Path $state 'current-backend-commit.txt') $InitialBackendCommit -NoNewline
Write-Host "PASS. Migration backup: $backupRoot"
