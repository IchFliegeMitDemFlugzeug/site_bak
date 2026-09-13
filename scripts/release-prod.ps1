param([switch]$dryrun)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repo 'dist'
$backend = Join-Path $repo 'backend'
$preflight = Join-Path $repo 'scripts\preflight.ps1'
$backendPackaging = Join-Path $repo 'scripts\backend-package.ps1'
$ensureSource = Join-Path $repo 'scripts\production\ensure-production.ps1'
$workerSource = Join-Path $repo 'scripts\production\worker-v2.ps1'
$serviceConfigSource = Join-Path $repo 'backend\config\BTS.ContactApi.xml'
$outRoot = Join-Path $repo '.release'
$toolCache = Join-Path $outRoot 'tools\winsw-2.12.0'
$winSWCache = Join-Path $toolCache 'WinSW-x64.exe'
$winSWUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$sshKey = 'C:\ProgramData\BTS\ssh\bts_prod_ed25519'
$remote = 'bts-deploy@135.106.194.75'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
Set-Location $repo

function Get-Git {
    return Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Filter git.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object FullName -Like '*\git\cmd\git.exe' | Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
function Invoke-Ssh([string]$Command) {
    $output = @(& ssh.exe -i $sshKey -o batchmode=yes -o connecttimeout=10 $remote $Command)
    if ($LASTEXITCODE -ne 0) { throw "production SSH command failed: $LASTEXITCODE" }
    return $output
}
function Copy-ToProduction([string]$LocalPath,[string]$RemotePath) {
    & scp.exe -i $sshKey -o batchmode=yes -o connecttimeout=10 $LocalPath "${remote}:$RemotePath"
    if ($LASTEXITCODE -ne 0) { throw "production upload failed for $LocalPath`: $LASTEXITCODE" }
}
function Get-RemoteResult([string]$ReleaseId,[string[]]$TerminalStatuses,[int]$TimeoutSeconds=240) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $raw = Invoke-Ssh "powershell.exe -noprofile -command `"if(test-path 'C:\ProgramData\BTS\deploy\outbox\$ReleaseId.json'){get-content 'C:\ProgramData\BTS\deploy\outbox\$ReleaseId.json' -raw}`""
        if ($raw) {
            try { $result = ($raw -join "`n") | ConvertFrom-Json; if ($TerminalStatuses -contains [string]$result.status) { return $result } } catch { }
        }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)
    throw "timed out waiting for production worker result for $ReleaseId"
}
function Get-ProductionState {
    $command = @'
$state='C:\ProgramData\BTS\deploy\state'
$worker='C:\ProgramData\BTS\deploy\worker.ps1'
$task=Get-ScheduledTask -TaskPath '\bts\' -TaskName 'bts deploy worker' -ErrorAction SilentlyContinue
$service=Get-Service BTSContactApi -ErrorAction SilentlyContinue
$server='C:\Sites\BTS\backend-current\server.js'
$health=$false
if(Test-Path $server){try{$r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/api/health -TimeoutSec 5;$health=$r.StatusCode -eq 200 -and $r.Content.Trim() -ceq'{"ok":true}'}catch{}}
$rule=$false
try{$x=Get-WebConfigurationProperty -PSPath MACHINE/WEBROOT/APPHOST -Location BTS -Filter "system.webServer/rewrite/rules/rule[@name='BTS API reverse proxy']/action" -Name url -ErrorAction Stop;$rule=[string]$x.Value -ceq 'http://127.0.0.1:3001/api/{R:1}'}catch{}
$smtp=@('SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','CONTACT_TO')|?{[string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_,'Machine'))}
$o=[ordered]@{
 node=Test-Path 'C:\Program Files\nodejs\node.exe';iis=Test-Path "$env:windir\system32\inetsrv\appcmd.exe"
 rewrite=[bool](Get-WebGlobalModule RewriteModule -ErrorAction SilentlyContinue);arr=$null -ne (Get-WebConfiguration -PSPath MACHINE/WEBROOT/APPHOST -Filter system.webServer/proxy -ErrorAction SilentlyContinue)
 arr_enabled=[bool](Get-WebConfigurationProperty -PSPath MACHINE/WEBROOT/APPHOST -Filter system.webServer/proxy -Name enabled -ErrorAction SilentlyContinue).Value
 worker_hash=if(Test-Path $worker){(Get-FileHash $worker -Algorithm SHA256).Hash.ToLower()}else{''}
 task_ok=[bool]($task -and $task.Actions.Count -eq 1 -and $task.Actions[0].Arguments -like'*C:\ProgramData\BTS\deploy\worker.ps1*')
 service_installed=[bool]$service;service_ready=[bool]($service -and $service.StartType -eq 'Automatic' -and $service.Status -eq 'Running' -and $health)
 backend_health=$health;api_proxy=[bool]($health -and $rule);smtp_ok=$smtp.Count -eq 0
 frontend_tree=if(Test-Path "$state\current-frontend-tree.txt"){(gc "$state\current-frontend-tree.txt" -Raw).Trim()}else{''}
 frontend_commit=if(Test-Path "$state\current-commit.txt"){(gc "$state\current-commit.txt" -Raw).Trim()}else{''}
 backend_tree=if(Test-Path "$state\current-backend-tree.txt"){(gc "$state\current-backend-tree.txt" -Raw).Trim()}else{''}
 schema=if(Test-Path "$state\deployment-schema-version.txt"){(gc "$state\deployment-schema-version.txt" -Raw).Trim()}else{''}
 dirs_ok=@('C:\Sites\BTS\backend-releases','C:\ProgramData\BTS\contact-api','C:\ProgramData\BTS\contact-api\logs',"$state\processed")|?{-not(Test-Path $_)}|%{$_}|Measure-Object|% Count
};[pscustomobject]$o|ConvertTo-Json -Compress
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    return ((Invoke-Ssh "powershell.exe -NoProfile -EncodedCommand $encoded") -join "`n") | ConvertFrom-Json
}
function Show-Infrastructure($State,[string]$ExpectedWorkerHash) {
    $workerOk = $State.worker_hash -eq $ExpectedWorkerHash
    $prerequisites = $State.node -and $State.iis -and $State.rewrite -and $State.arr -and $State.smtp_ok
    $ready = $prerequisites -and $workerOk -and $State.task_ok -and $State.schema -eq '2' -and $State.dirs_ok -eq 0 -and ((-not $State.backend_health) -or ($State.service_ready -and $State.arr_enabled -and $State.api_proxy))
    function Mark($ok,$bad) { if ($ok) {'PASS'} else {$bad} }
    Write-Host 'Production infrastructure:'
    Write-Host "Node ............... $(Mark $State.node 'MISSING')"
    Write-Host "URL Rewrite ........ $(Mark $State.rewrite 'MISSING')"
    Write-Host "ARR ................ $(Mark $State.arr 'MISSING')"
    Write-Host "Worker ............. $(Mark $workerOk 'UPDATE REQUIRED')"
    Write-Host "BTSContactApi ....... $(if(-not $State.service_installed){'MISSING'}elseif($State.service_ready){'PASS'}else{'REPAIR REQUIRED'})"
    Write-Host "API proxy ........... $(if($State.api_proxy){'PASS'}elseif($State.backend_health){'REPAIR REQUIRED'}else{'NOT READY'})"
    Write-Host "SMTP environment ... $(Mark $State.smtp_ok 'MISSING')"
    Write-Host "Infrastructure action: $(if($ready){'PASS'}else{'RECONCILE'})"
    if (-not $prerequisites) { throw 'Base production prerequisite is missing. No deployment is allowed.' }
    return $ready
}
function Invoke-Ensure([string]$RemoteDirectory) {
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$RemoteDirectory\ensure-production.ps1`" -WorkerSource `"$RemoteDirectory\worker-v2.ps1`" -ServiceConfigSource `"$RemoteDirectory\BTS.ContactApi.xml`" -WinSWSource `"$RemoteDirectory\WinSW-x64.exe`""
    Invoke-Ssh $command | ForEach-Object { Write-Host $_ }
}
function Get-WinSW {
    New-Item -ItemType Directory -Path $toolCache -Force | Out-Null
    if (Test-Path $winSWCache) {
        $signature = Get-AuthenticodeSignature $winSWCache
        if ($signature.Status -eq 'Valid') { return $winSWCache }
        Remove-Item $winSWCache -Force
    }
    Invoke-WebRequest -UseBasicParsing -Uri $winSWUrl -OutFile $winSWCache
    $signature = Get-AuthenticodeSignature $winSWCache
    if ($signature.Status -ne 'Valid') { Remove-Item $winSWCache -Force; throw "Downloaded WinSW signature is not valid: $($signature.Status)" }
    return $winSWCache
}
function Get-HttpResult([string]$Url) {
    try { $r=Invoke-WebRequest -UseBasicParsing -Uri $Url -MaximumRedirection 5 -TimeoutSec 20; return [pscustomobject]@{status=[int]$r.StatusCode;xrobots=[string]$r.Headers['X-Robots-Tag'];body=[string]$r.Content} }
    catch { if($_.Exception.Response){return [pscustomobject]@{status=[int]$_.Exception.Response.StatusCode;xrobots='';body=''}};throw }
}
function Test-ExternalProduction([string[]]$Urls) {
    foreach($url in $Urls){$r=Get-HttpResult $url;if($r.status -ne 200 -or $r.xrobots){throw "external check failed: $url"};Write-Host "PASS: $url"}
    if((Get-HttpResult 'https://btsys.ru/__bts_release_probe_missing__').status -ne 404){throw 'external 404 failed'}
    $health=Get-HttpResult 'https://btsys.ru/api/health';if($health.status -ne 200 -or $health.body.Trim() -cne'{"ok":true}'){throw 'external backend health failed'}
}

Write-Host '=== release precheck ==='
$git=Get-Git;if(-not$git){throw 'git executable not found'}
foreach($path in @($dist,$backend,$preflight,$ensureSource,$workerSource,$serviceConfigSource)){if(-not(Test-Path $path)){throw "required path missing: $path"}}
$branch=(& $git branch --show-current).Trim();if($branch -ne 'main'){throw "wrong branch: $branch"}
$changes = @(& $git status --porcelain)
if ($changes.Count -ne 0) { throw 'git working tree is not clean' }
$head=(& $git rev-parse HEAD).Trim()
& $git fetch origin main --prune;if($LASTEXITCODE -ne 0){throw 'git fetch failed'}
if($head -ne (& $git rev-parse origin/main).Trim()){throw 'local main differs from origin/main; Pull and inspect staging again'}
if(-not(Test-Path $sshKey)){throw "SSH private key not found: $sshKey"}
Invoke-Ssh 'cmd.exe /d /c exit 0'|Out-Null
$expectedWorkerHash=(Get-FileHash $workerSource -Algorithm SHA256).Hash.ToLower()
$production=Get-ProductionState
$infrastructureReady=Show-Infrastructure $production $expectedWorkerHash
$frontendTree=(& $git rev-parse 'HEAD:dist').Trim();$backendTree=(& $git rev-parse 'HEAD:backend').Trim()
$productionFrontendTree=[string]$production.frontend_tree
if(-not$productionFrontendTree -and [string]$production.frontend_commit -match'^[0-9a-f]{40}$'){$candidate=@(&$git rev-parse "$($production.frontend_commit):dist" 2>$null);if($LASTEXITCODE -eq 0){$productionFrontendTree=($candidate-join'').Trim()}}
$frontendChanged=$frontendTree -ne $productionFrontendTree;$backendChanged=$backendTree -ne [string]$production.backend_tree
Write-Host "FRONTEND action: $(if($frontendChanged){'DEPLOY'}else{'SKIP'})"
Write-Host "BACKEND action: $(if($backendChanged){'DEPLOY'}else{'SKIP'})"
Write-Host '=== existing project preflight ==='
# The read-only state query must precede preflight so an unchanged backend gets
# a true SKIP: no npm install, packaging, upload, switch, restart, or state write.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $preflight -BackendChanged:$backendChanged
if($LASTEXITCODE -ne 0){throw 'project preflight failed'}
$postPreflightChanges = @(& $git status --porcelain)
if($head -ne (& $git rev-parse HEAD).Trim() -or $postPreflightChanges.Count -ne 0){throw 'repository changed during preflight'}
& $git fetch origin main --prune;if($LASTEXITCODE -ne 0){throw 'final git fetch failed'}
if($head -ne (& $git rev-parse origin/main).Trim()){throw 'origin/main changed during preflight; Pull and inspect staging again'}
if($dryrun){Write-Host 'PASS: dry run is read-only; nothing was uploaded or changed on production.';return}

Write-Host '=== production infrastructure reconcile ==='
$winSW=Get-WinSW
$infraId="infra_$($head.Substring(0,12))"
$remoteInfra="C:\ProgramData\BTS\deploy\incoming\$infraId"
Invoke-Ssh "powershell.exe -NoProfile -Command `"New-Item -ItemType Directory -Force '$remoteInfra'|Out-Null`""|Out-Null
Copy-ToProduction $ensureSource "C:/ProgramData/BTS/deploy/incoming/$infraId/ensure-production.ps1"
Copy-ToProduction $workerSource "C:/ProgramData/BTS/deploy/incoming/$infraId/worker-v2.ps1"
Copy-ToProduction $serviceConfigSource "C:/ProgramData/BTS/deploy/incoming/$infraId/BTS.ContactApi.xml"
Copy-ToProduction $winSW "C:/ProgramData/BTS/deploy/incoming/$infraId/WinSW-x64.exe"
Invoke-Ensure $remoteInfra
$production=Get-ProductionState;Show-Infrastructure $production $expectedWorkerHash|Out-Null
# Re-read state after reconcile: it can recover missing state directories without inventing component versions.
$productionFrontendTree = [string]$production.frontend_tree
if (-not $productionFrontendTree -and [string]$production.frontend_commit -match '^[0-9a-f]{40}$') {
    $candidate = @(& $git rev-parse "$($production.frontend_commit):dist" 2>$null)
    if ($LASTEXITCODE -eq 0) { $productionFrontendTree = ($candidate -join '').Trim() }
}
$frontendChanged=$frontendTree -ne $productionFrontendTree;$backendChanged=$backendTree -ne [string]$production.backend_tree
if(-not$frontendChanged -and -not $backendChanged){Write-Host 'PASS: infrastructure is consistent; FRONTEND SKIP; BACKEND SKIP.';return}

$short=$head.Substring(0,12);$releaseId="$(Get-Date -Format yyyyMMdd-HHmmss)_$short";$outDir=Join-Path $outRoot $releaseId
New-Item -ItemType Directory -Path $outDir -Force|Out-Null;Add-Type -AssemblyName System.IO.Compression.FileSystem
$components=[ordered]@{}
if($frontendChanged){$archive=Join-Path $outDir "$releaseId.frontend.zip";[IO.Compression.ZipFile]::CreateFromDirectory($dist,$archive,[IO.Compression.CompressionLevel]::Optimal,$false);$components.frontend=[ordered]@{changed=$true;tree=$frontendTree;archive=[IO.Path]::GetFileName($archive);sha256=(Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()}}else{$components.frontend=[ordered]@{changed=$false;tree=$frontendTree;archive='';sha256=''}}
if($backendChanged){. $backendPackaging;$archive=Join-Path $outDir "$releaseId.backend.zip";New-BackendArtifact -BackendSource $backend -WorkingDirectory (Join-Path $outDir backend-runtime) -ArchivePath $archive -SkipInstall|Out-Null;$components.backend=[ordered]@{changed=$true;tree=$backendTree;archive=[IO.Path]::GetFileName($archive);sha256=(Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()}}else{$components.backend=[ordered]@{changed=$false;tree=$backendTree;archive='';sha256=''}}
$request=Join-Path $outDir "$releaseId.request.json";[IO.File]::WriteAllText($request,([ordered]@{release_id=$releaseId;commit=$head;components=$components}|ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
foreach($name in @('backend','frontend')){if($components[$name].changed){Copy-ToProduction (Join-Path $outDir $components[$name].archive) "C:/ProgramData/BTS/deploy/incoming/$($components[$name].archive)"}}
Copy-ToProduction $request "C:/ProgramData/BTS/deploy/incoming/$releaseId.request.json"
$result=Get-RemoteResult $releaseId @('deployed','rolled_back','failed');if($result.status -ne 'deployed'){throw "worker deployment failed: $($result.status): $($result.message)"}
Invoke-Ensure $remoteInfra
[xml]$sitemap=Get-Content (Join-Path $dist sitemap.xml) -Raw;$urls=@($sitemap.SelectNodes("//*[local-name()='loc']")|ForEach-Object{$_.InnerText.Trim()})
try { Test-ExternalProduction $urls }
catch {
    $externalError=$_.Exception.Message;$rollbackPath=Join-Path $outDir "$releaseId.rollback.json"
    [IO.File]::WriteAllText($rollbackPath,([ordered]@{release_id=$releaseId;components=[ordered]@{frontend=$frontendChanged;backend=$backendChanged}}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
    Copy-ToProduction $rollbackPath "C:/ProgramData/BTS/deploy/incoming/$releaseId.rollback.json"
    $rollback=Get-RemoteResult $releaseId @('rolled_back_external','rollback_request_failed')
    try { Invoke-Ensure $remoteInfra } catch { Write-Warning "post-rollback infrastructure check failed: $($_.Exception.Message)" }
    throw "external checks failed; rollback status $($rollback.status): $externalError"
}
Write-Host "PASS: production release $releaseId ($head)"
