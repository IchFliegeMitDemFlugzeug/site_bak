param([switch]$dryrun)

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Repo 'dist'
$Backend = Join-Path $Repo 'backend'
$Preflight = Join-Path $Repo 'scripts\preflight.ps1'
$BackendPackaging = Join-Path $Repo 'scripts\backend-package.ps1'
$EnsureSource = Join-Path $Repo 'scripts\production\ensure-production.ps1'
$WorkerSource = Join-Path $Repo 'scripts\production\worker-v2.ps1'
$ServiceConfigSource = Join-Path $Repo 'backend\config\BTS.ContactApi.xml'
$OutRoot = Join-Path $Repo '.release'
$SshKey = 'C:\ProgramData\BTS\ssh\bts_prod_ed25519'
$Remote = 'bts-deploy@135.106.194.75'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
Set-Location $Repo

function Get-Git {
    return (Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Filter git.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object FullName -Like '*\git\cmd\git.exe' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName)
}

function Invoke-Ssh {
    param([Parameter(Mandatory = $true)][string]$Command)
    $output = @(& ssh.exe -i $SshKey -o batchmode=yes -o connecttimeout=10 $Remote $Command)
    if ($LASTEXITCODE -ne 0) { throw "production SSH command failed: $LASTEXITCODE" }
    return $output
}

function Copy-ToProduction {
    param(
        [Parameter(Mandatory = $true)][string]$LocalPath,
        [Parameter(Mandatory = $true)][string]$RemotePath
    )
    & scp.exe -i $SshKey -o batchmode=yes -o connecttimeout=10 $LocalPath "${Remote}:$RemotePath"
    if ($LASTEXITCODE -ne 0) { throw "production upload failed for $LocalPath`: $LASTEXITCODE" }
}

function Get-RemoteResult {
    param(
        [Parameter(Mandatory = $true)][string]$RequestId,
        [Parameter(Mandatory = $true)][string[]]$TerminalStatuses,
        [int]$TimeoutSeconds = 240
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $command = "powershell.exe -NoProfile -Command `"if(Test-Path 'C:\ProgramData\BTS\deploy\outbox\$RequestId.json'){Get-Content 'C:\ProgramData\BTS\deploy\outbox\$RequestId.json' -Raw}`""
        $raw = Invoke-Ssh -Command $command
        if ($raw) {
            try {
                $result = ($raw -join "`n") | ConvertFrom-Json
                if ($TerminalStatuses -contains [string]$result.status) { return $result }
            }
            catch { }
        }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for SYSTEM worker result '$RequestId'. If production still has the legacy worker, run bootstrap-worker-v2.ps1 once as production Administrator."
}

function New-ReconcileId {
    $random = [Guid]::NewGuid().ToString('N').Substring(0,12)
    return "reconcile_$(Get-Date -Format yyyyMMdd-HHmmss)_$random"
}

function Invoke-ReconcileRequest {
    param([Parameter(Mandatory = $true)][ValidateSet('check','apply')][string]$Mode)
    $requestId = New-ReconcileId
    $localDirectory = Join-Path $OutRoot $requestId
    $requestPath = Join-Path $localDirectory "$requestId.reconcile.json"
    New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null
    $request = [ordered]@{
        release_id=$requestId
        mode=$Mode
        expected_worker_sha256=(Get-FileHash -LiteralPath $WorkerSource -Algorithm SHA256).Hash.ToLowerInvariant()
        expected_ensure_sha256=(Get-FileHash -LiteralPath $EnsureSource -Algorithm SHA256).Hash.ToLowerInvariant()
        expected_service_config_sha256=(Get-FileHash -LiteralPath $ServiceConfigSource -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    [IO.File]::WriteAllText($requestPath, ($request | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    Copy-ToProduction -LocalPath $requestPath -RemotePath "C:/ProgramData/BTS/deploy/incoming/$requestId.reconcile.json"
    $terminal = if ($Mode -eq 'check') { @('checked','bootstrap_required','reconcile_failed') } else { @('reconciled','bootstrap_required','reconcile_failed') }
    $timeout = if ($Mode -eq 'check') { 75 } else { 240 }
    $result = Get-RemoteResult -RequestId $requestId -TerminalStatuses $terminal -TimeoutSeconds $timeout
    if ($result.status -eq 'bootstrap_required') { throw "trusted production infrastructure is outdated: $($result.message)" }
    if ($result.status -eq 'reconcile_failed') { throw "production reconcile failed: $($result.message)" }
    return $result
}

function Show-InfrastructureResult {
    param([Parameter(Mandatory = $true)]$Details)
    function Mark([bool]$Ok,[string]$Failure) { if ($Ok) { 'PASS' } else { $Failure } }
    Write-Host 'Production infrastructure:'
    Write-Host "Node ............... $(Mark $Details.node 'MISSING')"
    Write-Host "IIS ................ $(Mark $Details.iis 'MISSING')"
    Write-Host "URL Rewrite ........ $(Mark $Details.url_rewrite 'MISSING')"
    Write-Host "ARR ................ $(Mark $Details.arr 'MISSING')"
    Write-Host "Worker ............. $(Mark $Details.worker 'UPDATE REQUIRED')"
    Write-Host "Ensure ............. $(Mark $Details.ensure 'UPDATE REQUIRED')"
    Write-Host "Scheduled Task ..... $(Mark $Details.scheduled_task 'REPAIR REQUIRED')"
    Write-Host "BTSContactApi ....... $(if (-not $Details.service_installed) { 'MISSING' } elseif ($Details.service_ready) { 'PASS' } else { 'REPAIR REQUIRED' })"
    Write-Host "API proxy ........... $(if ($Details.api_proxy) { 'PASS' } elseif ($Details.backend_health) { 'REPAIR REQUIRED' } else { 'NOT READY' })"
    Write-Host "SMTP environment ... $(Mark $Details.smtp_environment 'MISSING/INVALID')"
    Write-Host "Infrastructure action: $(if ($Details.reconcile_required) { 'RECONCILE' } else { 'PASS' })"
}

function Get-HttpResult {
    param([Parameter(Mandatory = $true)][string]$Url)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -MaximumRedirection 5 -TimeoutSec 20
        return [pscustomobject]@{ status=[int]$response.StatusCode; xrobots=[string]$response.Headers['X-Robots-Tag']; body=[string]$response.Content }
    }
    catch {
        if ($_.Exception.Response) { return [pscustomobject]@{ status=[int]$_.Exception.Response.StatusCode; xrobots=''; body='' } }
        throw
    }
}

function Test-ExternalProduction {
    param([Parameter(Mandatory = $true)][string[]]$Urls)
    foreach ($url in $Urls) {
        $result = Get-HttpResult $url
        if ($result.status -ne 200 -or $result.xrobots) { throw "external check failed: $url" }
        Write-Host "PASS: $url"
    }
    if ((Get-HttpResult 'https://btsys.ru/__bts_release_probe_missing__').status -ne 404) { throw 'external 404 failed' }
    $health = Get-HttpResult 'https://btsys.ru/api/health'
    if ($health.status -ne 200 -or $health.body.Trim() -cne '{"ok":true}') { throw 'external backend health failed' }
}

Write-Host '=== release precheck ==='
$Git = Get-Git
if (-not $Git) { throw 'git executable not found' }
foreach ($path in @($Dist,$Backend,$Preflight,$EnsureSource,$WorkerSource,$ServiceConfigSource)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "required path missing: $path" }
}
$branch = (& $Git branch --show-current).Trim()
if ($branch -ne 'main') { throw "wrong branch: $branch" }
$initialChanges = @(& $Git status --porcelain)
if ($initialChanges.Count -ne 0) { throw 'git working tree is not clean' }
$head = (& $Git rev-parse HEAD).Trim()
& $Git fetch origin main --prune
if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
if ($head -ne (& $Git rev-parse origin/main).Trim()) { throw 'local main differs from origin/main; Pull and inspect staging again' }
if (-not (Test-Path -LiteralPath $SshKey)) { throw "SSH private key not found: $SshKey" }
Invoke-Ssh -Command 'cmd.exe /d /c exit 0' | Out-Null

Write-Host '=== read-only SYSTEM infrastructure check ==='
$checkResult = Invoke-ReconcileRequest -Mode check
$production = $checkResult.details
Show-InfrastructureResult $production
if (-not $production.prerequisites) { throw 'Base production prerequisite is missing. No deployment is allowed.' }
$frontendTree = (& $Git rev-parse 'HEAD:dist').Trim()
$backendTree = (& $Git rev-parse 'HEAD:backend').Trim()
$productionFrontendTree = [string]$production.frontend_tree
if (-not $productionFrontendTree -and [string]$production.frontend_commit -match '^[0-9a-f]{40}$') {
    $candidate = @(& $Git rev-parse "$($production.frontend_commit):dist" 2>$null)
    if ($LASTEXITCODE -eq 0) { $productionFrontendTree = ($candidate -join '').Trim() }
}
$frontendChanged = $frontendTree -ne $productionFrontendTree
$backendChanged = $backendTree -ne [string]$production.backend_tree
Write-Host "FRONTEND action: $(if ($frontendChanged) { 'DEPLOY' } else { 'SKIP' })"
Write-Host "BACKEND action: $(if ($backendChanged) { 'DEPLOY' } else { 'SKIP' })"

Write-Host '=== existing project preflight ==='
if ($backendChanged) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Preflight -BackendChanged
}
else {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Preflight
}
if ($LASTEXITCODE -ne 0) { throw 'project preflight failed' }
$postPreflightChanges = @(& $Git status --porcelain)
if ($head -ne (& $Git rev-parse HEAD).Trim() -or $postPreflightChanges.Count -ne 0) { throw 'repository changed during preflight' }
& $Git fetch origin main --prune
if ($LASTEXITCODE -ne 0) { throw 'final git fetch failed' }
if ($head -ne (& $Git rev-parse origin/main).Trim()) { throw 'origin/main changed during preflight; Pull and inspect staging again' }
if ($dryrun) {
    Write-Host 'PASS: dry run used CheckOnly through the SYSTEM worker; no infrastructure or site setting was changed.'
    return
}

Write-Host '=== SYSTEM infrastructure reconcile ==='
$reconcileResult = Invoke-ReconcileRequest -Mode apply
$production = $reconcileResult.details
Show-InfrastructureResult $production
$productionFrontendTree = [string]$production.frontend_tree
if (-not $productionFrontendTree -and [string]$production.frontend_commit -match '^[0-9a-f]{40}$') {
    $candidate = @(& $Git rev-parse "$($production.frontend_commit):dist" 2>$null)
    if ($LASTEXITCODE -eq 0) { $productionFrontendTree = ($candidate -join '').Trim() }
}
$frontendChanged = $frontendTree -ne $productionFrontendTree
$backendChanged = $backendTree -ne [string]$production.backend_tree
if (-not $frontendChanged -and -not $backendChanged) {
    Write-Host 'PASS: infrastructure is consistent; FRONTEND SKIP; BACKEND SKIP.'
    return
}

$releaseId = "$(Get-Date -Format yyyyMMdd-HHmmss)_$($head.Substring(0,12))"
$outDirectory = Join-Path $OutRoot $releaseId
New-Item -ItemType Directory -Path $outDirectory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$components = [ordered]@{}
if ($frontendChanged) {
    $archive = Join-Path $outDirectory "$releaseId.frontend.zip"
    [IO.Compression.ZipFile]::CreateFromDirectory($Dist,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
    $components.frontend = [ordered]@{ changed=$true; tree=$frontendTree; archive=[IO.Path]::GetFileName($archive); sha256=(Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() }
}
else { $components.frontend = [ordered]@{ changed=$false; tree=$frontendTree; archive=''; sha256='' } }
if ($backendChanged) {
    . $BackendPackaging
    $archive = Join-Path $outDirectory "$releaseId.backend.zip"
    New-BackendArtifact -BackendSource $Backend -WorkingDirectory (Join-Path $outDirectory 'backend-runtime') -ArchivePath $archive -SkipInstall | Out-Null
    $components.backend = [ordered]@{ changed=$true; tree=$backendTree; archive=[IO.Path]::GetFileName($archive); sha256=(Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() }
}
else { $components.backend = [ordered]@{ changed=$false; tree=$backendTree; archive=''; sha256='' } }
$requestPath = Join-Path $outDirectory "$releaseId.request.json"
$request = [ordered]@{ release_id=$releaseId; commit=$head; components=$components }
[IO.File]::WriteAllText($requestPath, ($request | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
foreach ($name in @('backend','frontend')) {
    if ($components[$name].changed) { Copy-ToProduction -LocalPath (Join-Path $outDirectory $components[$name].archive) -RemotePath "C:/ProgramData/BTS/deploy/incoming/$($components[$name].archive)" }
}
Copy-ToProduction -LocalPath $requestPath -RemotePath "C:/ProgramData/BTS/deploy/incoming/$releaseId.request.json"
$result = Get-RemoteResult -RequestId $releaseId -TerminalStatuses @('deployed','rolled_back','failed')
if ($result.status -ne 'deployed') { throw "worker deployment failed: $($result.status): $($result.message)" }

Invoke-ReconcileRequest -Mode apply | Out-Null
[xml]$sitemap = Get-Content (Join-Path $Dist 'sitemap.xml') -Raw
$urls = @($sitemap.SelectNodes("//*[local-name()='loc']") | ForEach-Object { $_.InnerText.Trim() })
$externalOk = $false
$externalError = ''
for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
        Write-Host "external production checks: attempt $attempt/3"
        Test-ExternalProduction $urls
        $externalOk = $true
        break
    }
    catch {
        $externalError = $_.Exception.Message
        if ($attempt -lt 3) { Start-Sleep -Seconds 5 }
    }
}
if (-not $externalOk) {
    $rollbackPath = Join-Path $outDirectory "$releaseId.rollback.json"
    $rollback = [ordered]@{ release_id=$releaseId; components=[ordered]@{ frontend=$frontendChanged; backend=$backendChanged } }
    [IO.File]::WriteAllText($rollbackPath, ($rollback | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Copy-ToProduction -LocalPath $rollbackPath -RemotePath "C:/ProgramData/BTS/deploy/incoming/$releaseId.rollback.json"
    $rollbackResult = Get-RemoteResult -RequestId $releaseId -TerminalStatuses @('rolled_back_external','rollback_request_failed')
    try { Invoke-ReconcileRequest -Mode apply | Out-Null } catch { Write-Warning "post-rollback reconcile failed: $($_.Exception.Message)" }
    throw "external checks failed after three attempts; rollback status $($rollbackResult.status): $externalError"
}
Write-Host "PASS: production release $releaseId ($head)"
