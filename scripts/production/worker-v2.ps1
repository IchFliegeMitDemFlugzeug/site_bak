$ErrorActionPreference = 'Stop'
$DeployRoot = 'C:\ProgramData\BTS\deploy'
$Incoming = Join-Path $DeployRoot 'incoming'
$Outbox = Join-Path $DeployRoot 'outbox'
$State = Join-Path $DeployRoot 'state'
$Processed = Join-Path $State 'processed'
$FrontendReleases = 'C:\Sites\BTS\releases'
$BackendReleases = 'C:\Sites\BTS\backend-releases'
$BackendCurrent = 'C:\Sites\BTS\backend-current'
$ServiceName = 'BTSContactApi'
$AppCmd = "$env:windir\system32\inetsrv\appcmd.exe"
$TrustedRoot = Join-Path $DeployRoot 'trusted'
$TrustedWorker = Join-Path $TrustedRoot 'worker.ps1'
$EnsureTarget = Join-Path $TrustedRoot 'ensure-production.ps1'
$TrustedWinSW = Join-Path $TrustedRoot 'WinSW-x64.exe'
$TrustedServiceConfig = Join-Path $TrustedRoot 'BTS.ContactApi.xml'

function Test-TrustedAcl {
    if (-not (Test-Path -LiteralPath $TrustedRoot -PathType Container)) { return $false }
    $acl = Get-Acl -LiteralPath $TrustedRoot
    if (-not $acl.AreAccessRulesProtected) { return $false }
    $allowedSids = @('S-1-5-18','S-1-5-32-544')
    $seenSids = @()
    foreach ($rule in $acl.Access | Where-Object AccessControlType -eq 'Allow') {
        try { $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }
        catch { return $false }
        if ($allowedSids -notcontains $sid) { return $false }
        $seenSids += $sid
    }
    return @($allowedSids | Where-Object { $seenSids -notcontains $_ }).Count -eq 0
}

function Write-Result([string]$ReleaseId, [string]$Status, [string]$Message, $Snapshot = $null, $Details = $null) {
    $result = [ordered]@{ release_id = $ReleaseId; status = $Status; message = $Message }
    if ($Snapshot) { $result.snapshot = $Snapshot }
    if ($Details) { $result.details = $Details }
    $temporary = Join-Path $Outbox "$ReleaseId.json.tmp"
    $target = Join-Path $Outbox "$ReleaseId.json"
    [IO.File]::WriteAllText($temporary, ($result | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $target -Force
}

function Process-Reconcile($Request, [string]$RequestPath) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.User.Value -ne 'S-1-5-18') { throw 'reconcile requests may run only in the SYSTEM worker' }
    $requestId = [string]$Request.release_id
    if ($requestId -notmatch '^reconcile_[0-9]{8}-[0-9]{6}_[0-9a-f]{12}$') { throw 'invalid reconcile request id' }
    if ([string]$Request.mode -notin @('check','apply')) { throw 'invalid reconcile mode' }
    if ([string]$Request.expected_worker_sha256 -notmatch '^[0-9a-f]{64}$') { throw 'invalid expected worker hash' }
    if ([string]$Request.expected_ensure_sha256 -notmatch '^[0-9a-f]{64}$') { throw 'invalid expected ensure hash' }
    if ([string]$Request.expected_service_config_sha256 -notmatch '^[0-9a-f]{64}$') { throw 'invalid expected service config hash' }
    try {
        if (-not (Test-TrustedAcl)) {
            Write-Result $requestId 'bootstrap_required' 'trusted infrastructure ACL is missing or unsafe; rerun Administrator bootstrap'
            return
        }
        foreach ($trustedPath in @($TrustedWorker,$EnsureTarget,$TrustedServiceConfig,$TrustedWinSW)) {
            if (-not (Test-Path -LiteralPath $trustedPath -PathType Leaf)) {
                Write-Result $requestId 'bootstrap_required' "trusted infrastructure asset is missing: $([IO.Path]::GetFileName($trustedPath))"
                return
            }
        }
        $trustedWorkerHash = (Get-FileHash -LiteralPath $TrustedWorker -Algorithm SHA256).Hash.ToLowerInvariant()
        $trustedEnsureHash = (Get-FileHash -LiteralPath $EnsureTarget -Algorithm SHA256).Hash.ToLowerInvariant()
        $trustedConfigHash = (Get-FileHash -LiteralPath $TrustedServiceConfig -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($trustedWorkerHash -ne [string]$Request.expected_worker_sha256 -or
            $trustedEnsureHash -ne [string]$Request.expected_ensure_sha256 -or
            $trustedConfigHash -ne [string]$Request.expected_service_config_sha256) {
            Write-Result $requestId 'bootstrap_required' 'trusted infrastructure assets are outdated; rerun Administrator bootstrap'
            return
        }
        if ([string]$Request.mode -eq 'apply') {
            $output = & $EnsureTarget -WorkerSource $TrustedWorker -ServiceConfigSource $TrustedServiceConfig -WinSWSource $TrustedWinSW -ExpectedWorkerHash $Request.expected_worker_sha256 -ExpectedEnsureHash $Request.expected_ensure_sha256
            $details = ($output | Select-Object -Last 1) | ConvertFrom-Json
            Write-Result $requestId 'reconciled' 'production infrastructure reconciled by SYSTEM worker' $null $details
        }
        else {
            if (-not (Test-Path -LiteralPath $EnsureTarget -PathType Leaf)) { throw 'worker bootstrap is required: canonical ensure-production.ps1 is missing' }
            $output = & $EnsureTarget -CheckOnly -WorkerSource $TrustedWorker -ExpectedWorkerHash $Request.expected_worker_sha256 -ExpectedEnsureHash $Request.expected_ensure_sha256
            $details = ($output | Select-Object -Last 1) | ConvertFrom-Json
            Write-Result $requestId 'checked' 'production infrastructure checked without changes' $null $details
        }
    }
    catch {
        Write-Result $requestId 'reconcile_failed' $_.Exception.Message
    }
    finally {
        Move-Item -LiteralPath $RequestPath -Destination (Join-Path $Processed ([IO.Path]::GetFileName($RequestPath))) -Force
    }
}

function Get-TextState([string]$Name) {
    $path = Join-Path $State $Name
    if (Test-Path -LiteralPath $path) { return (Get-Content -LiteralPath $path -Raw).Trim() }
    return ''
}

function Set-TextState([string]$Name, [string]$Value) {
    [IO.File]::WriteAllText((Join-Path $State $Name), $Value, (New-Object Text.UTF8Encoding($false)))
}

function Test-Frontend {
    [xml]$sitemap = Get-Content (Join-Path (& $AppCmd list vdir 'BTS/' '/text:physicalPath') 'sitemap.xml') -Raw
    foreach ($url in @($sitemap.SelectNodes("//*[local-name()='loc']") | ForEach-Object { $_.'#text'.Trim() })) {
        & curl.exe -fsS --resolve 'btsys.ru:443:127.0.0.1' $url -o NUL
        if ($LASTEXITCODE -ne 0) { throw "frontend health failed: $url" }
    }
    $status = & curl.exe -sS --resolve 'btsys.ru:443:127.0.0.1' -o NUL -w '%{http_code}' 'https://btsys.ru/__bts_release_probe_missing__'
    if ($status -ne '404') { throw "frontend 404 health failed: $status" }
}

function Test-Backend {
    $body = & curl.exe -fsS 'http://127.0.0.1:3001/api/health'
    if ($LASTEXITCODE -ne 0 -or (($body | Out-String).Trim() -ne '{"ok":true}')) { throw 'backend health failed' }
}

function Set-BackendJunction([string]$Target) {
    if (Test-Path -LiteralPath $BackendCurrent) { cmd.exe /d /c "rmdir `"$BackendCurrent`"" | Out-Null }
    cmd.exe /d /c "mklink /J `"$BackendCurrent`" `"$Target`"" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'backend-current junction switch failed' }

    # LocalService runs the backend through backend-current.  The release
    # target already has RX; grant RX on the junction itself as well.
    & icacls.exe $BackendCurrent /grant:r '*S-1-5-19:RX' /L | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'backend-current junction ACL failed' }
}

function Restore-Snapshot($Snapshot, [bool]$FrontendChanged, [bool]$BackendChanged) {
    if ($FrontendChanged -and $Snapshot.frontend_path) {
        & $AppCmd set vdir 'BTS/' "/physicalPath:$($Snapshot.frontend_path)" | Out-Null
    }
    if ($BackendChanged -and $Snapshot.backend_path) {
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Set-BackendJunction $Snapshot.backend_path
        Start-Service -Name $ServiceName
    }
    elseif ($BackendChanged) {
        # The first backend release has no previous junction.  A failed first
        # deployment must therefore remove the newly-created junction instead
        # of accidentally leaving the failed runtime active.
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $BackendCurrent) {
            cmd.exe /d /c "rmdir `"$BackendCurrent`"" | Out-Null
        }
    }
    if ($BackendChanged -and $Snapshot.backend_path) { Test-Backend }
    if ($FrontendChanged -and $Snapshot.frontend_path) { Test-Frontend }
}

function Deploy-Request($Request, [string]$RequestPath) {
    $releaseId = [string]$Request.release_id
    if ($releaseId -notmatch '^[0-9]{8}-[0-9]{6}_[0-9a-f]{12}$') { throw 'invalid release_id' }
    if ([string]$Request.commit -notmatch '^[0-9a-f]{40}$') { throw 'invalid commit' }
    $frontendChanged = [bool]$Request.components.frontend.changed
    $backendChanged = [bool]$Request.components.backend.changed
    if (-not $frontendChanged -and -not $backendChanged) { throw 'request has no changed components' }
    $snapshot = [ordered]@{
        frontend_path = (& $AppCmd list vdir 'BTS/' '/text:physicalPath').Trim()
        frontend_tree = Get-TextState 'current-frontend-tree.txt'
        frontend_commit = Get-TextState 'current-frontend-commit.txt'
        frontend_release = Get-TextState 'current-release.txt'
        backend_path = if (Test-Path $BackendCurrent) { (Get-Item $BackendCurrent).Target } else { '' }
        backend_tree = Get-TextState 'current-backend-tree.txt'
        backend_commit = Get-TextState 'current-backend-commit.txt'
        backend_release = Get-TextState 'current-backend-release.txt'
    }
    $frontendTarget = ''
    $backendTarget = ''
    try {
        foreach ($name in @('backend','frontend')) {
            $component = $Request.components.$name
            if (-not [bool]$component.changed) { continue }
            if ([string]$component.tree -notmatch '^[0-9a-f]{40}$') { throw "invalid $name tree" }
            if ([string]$component.sha256 -notmatch '^[0-9a-f]{64}$') { throw "invalid $name sha256" }
            if ([string]$component.archive -notmatch '^[0-9A-Za-z._-]+\.zip$') { throw "invalid $name archive" }
            $archivePath = Join-Path $Incoming ([string]$component.archive)
            if (-not (Test-Path -LiteralPath $archivePath)) { throw "$name archive missing" }
            $actualHash = (Get-FileHash $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actualHash -ne [string]$component.sha256) { throw "$name archive hash mismatch" }
            $targetRoot = if ($name -eq 'backend') { $BackendReleases } else { $FrontendReleases }
            $target = Join-Path $targetRoot $releaseId
            if (Test-Path $target) { throw "$name immutable release already exists" }
            Expand-Archive -LiteralPath $archivePath -DestinationPath $target
            if ($name -eq 'backend') { $backendTarget = $target } else { $frontendTarget = $target }
        }
        if ($backendChanged) {
            if (-not (Test-Path (Join-Path $backendTarget 'server.js')) -or -not (Test-Path (Join-Path $backendTarget 'node_modules'))) { throw 'backend artifact is incomplete' }
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            Set-BackendJunction $backendTarget
            Start-Service -Name $ServiceName
            Test-Backend
        }
        if ($frontendChanged) {
            if (-not (Test-Path (Join-Path $frontendTarget 'index.html'))) { throw 'frontend artifact is incomplete' }
            & $AppCmd set vdir 'BTS/' "/physicalPath:$frontendTarget" | Out-Null
            Test-Frontend
        }
        if ($frontendChanged) {
            Set-TextState 'current-frontend-tree.txt' ([string]$Request.components.frontend.tree)
            Set-TextState 'current-frontend-commit.txt' ([string]$Request.commit)
            Set-TextState 'current-release.txt' $frontendTarget
            Set-TextState 'current-commit.txt' ([string]$Request.commit)
        }
        if ($backendChanged) {
            Set-TextState 'current-backend-tree.txt' ([string]$Request.components.backend.tree)
            Set-TextState 'current-backend-commit.txt' ([string]$Request.commit)
            Set-TextState 'current-backend-release.txt' $backendTarget
        }
        $snapshot['deployed_frontend_path'] = $frontendTarget
        $snapshot['deployed_backend_path'] = $backendTarget
        Write-Result $releaseId 'deployed' 'deployment and health checks passed' $snapshot
    }
    catch {
        try {
            Restore-Snapshot $snapshot $frontendChanged $backendChanged
            Write-Result $releaseId 'rolled_back' "deployment failed; all changed components restored: $($_.Exception.Message)" $snapshot
        }
        catch {
            Write-Result $releaseId 'failed' "deployment and rollback failed: $($_.Exception.Message)" $snapshot
        }
    }
    finally {
        foreach ($name in @('backend','frontend')) {
            $archiveName = [string]$Request.components.$name.archive
            if ($archiveName) { Remove-Item (Join-Path $Incoming $archiveName) -Force -ErrorAction SilentlyContinue }
        }
        Move-Item -LiteralPath $RequestPath -Destination (Join-Path $Processed ([IO.Path]::GetFileName($RequestPath))) -Force
    }
}

function Process-Rollback($Rollback, [string]$RollbackPath) {
    $releaseId = [string]$Rollback.release_id
    $resultPath = Join-Path $Outbox "$releaseId.json"
    if (-not (Test-Path $resultPath)) { throw 'deployment result not found' }
    $result = Get-Content $resultPath -Raw | ConvertFrom-Json
    if ($result.status -ne 'deployed' -or -not $result.snapshot) { throw 'release is not rollbackable' }
    $frontendChanged = [bool]$Rollback.components.frontend
    $backendChanged = [bool]$Rollback.components.backend
    if ($frontendChanged -and ((& $AppCmd list vdir 'BTS/' '/text:physicalPath').Trim() -ne [string]$result.snapshot.deployed_frontend_path)) { throw 'frontend is no longer at the requested release' }
    if ($backendChanged -and ((Get-Item $BackendCurrent).Target -ne [string]$result.snapshot.deployed_backend_path)) { throw 'backend is no longer at the requested release' }
    Restore-Snapshot $result.snapshot $frontendChanged $backendChanged
    if ($frontendChanged) {
        Set-TextState 'current-frontend-tree.txt' ([string]$result.snapshot.frontend_tree)
        Set-TextState 'current-frontend-commit.txt' ([string]$result.snapshot.frontend_commit)
        Set-TextState 'current-release.txt' ([string]$result.snapshot.frontend_release)
        Set-TextState 'current-commit.txt' ([string]$result.snapshot.frontend_commit)
    }
    if ($backendChanged) {
        Set-TextState 'current-backend-tree.txt' ([string]$result.snapshot.backend_tree)
        Set-TextState 'current-backend-commit.txt' ([string]$result.snapshot.backend_commit)
        Set-TextState 'current-backend-release.txt' ([string]$result.snapshot.backend_release)
    }
    Write-Result $releaseId 'rolled_back_external' 'all components changed by the release were restored' $result.snapshot
    Move-Item $RollbackPath (Join-Path $Processed ([IO.Path]::GetFileName($RollbackPath))) -Force
}

New-Item -ItemType Directory -Force -Path $Incoming,$Outbox,$State,$Processed,$FrontendReleases,$BackendReleases | Out-Null
foreach ($reconcilePath in @(Get-ChildItem $Incoming -Filter '*.reconcile.json' -File)) {
    try { Process-Reconcile (Get-Content $reconcilePath.FullName -Raw | ConvertFrom-Json) $reconcilePath.FullName }
    catch { Write-Result $reconcilePath.BaseName.Replace('.reconcile','') 'reconcile_failed' $_.Exception.Message }
}
foreach ($rollbackPath in @(Get-ChildItem $Incoming -Filter '*.rollback.json' -File)) {
    try { Process-Rollback (Get-Content $rollbackPath.FullName -Raw | ConvertFrom-Json) $rollbackPath.FullName }
    catch { Write-Result $rollbackPath.BaseName.Replace('.rollback','') 'rollback_request_failed' $_.Exception.Message }
}
foreach ($requestPath in @(Get-ChildItem $Incoming -Filter '*.request.json' -File)) {
    try { Deploy-Request (Get-Content $requestPath.FullName -Raw | ConvertFrom-Json) $requestPath.FullName }
    catch {
        Write-Result $requestPath.BaseName.Replace('.request','') 'failed' $_.Exception.Message
        Move-Item $requestPath.FullName (Join-Path $Processed $requestPath.Name) -Force -ErrorAction SilentlyContinue
    }
}
