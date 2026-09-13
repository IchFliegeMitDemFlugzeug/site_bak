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

function Write-Result([string]$ReleaseId, [string]$Status, [string]$Message, $Snapshot = $null) {
    $result = [ordered]@{ release_id = $ReleaseId; status = $Status; message = $Message }
    if ($Snapshot) { $result.snapshot = $Snapshot }
    $temporary = Join-Path $Outbox "$ReleaseId.json.tmp"
    $target = Join-Path $Outbox "$ReleaseId.json"
    [IO.File]::WriteAllText($temporary, ($result | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $target -Force
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
