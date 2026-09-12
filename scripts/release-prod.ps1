param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Repo 'dist'
$Backend = Join-Path $Repo 'backend'
$Preflight = Join-Path $PSScriptRoot 'preflight.ps1'
$OutRoot = Join-Path $Repo '.release'
$SshKey = 'C:\ProgramData\BTS\ssh\bts_prod_ed25519'
$Remote = 'bts-deploy@135.106.194.75'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
Set-Location $Repo

function Get-Git {
    Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Filter git.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object FullName -Like '*\git\cmd\git.exe' | Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
function Invoke-Ssh([string]$Command) {
    $output = & ssh.exe -i $SshKey -o batchmode=yes -o connecttimeout=10 $Remote $Command
    if ($LASTEXITCODE -ne 0) { throw "production ssh failed: $LASTEXITCODE" }
    return ($output -join "`n").Trim()
}
function Get-RemoteResult([string]$ReleaseId,[string[]]$Statuses,[int]$Timeout=300) {
    $deadline = (Get-Date).AddSeconds($Timeout)
    do {
        $raw = Invoke-Ssh "powershell.exe -noprofile -command `"if(test-path 'C:\ProgramData\BTS\deploy\outbox\$ReleaseId.json'){get-content 'C:\ProgramData\BTS\deploy\outbox\$ReleaseId.json' -raw}`""
        if ($raw) { $result = $raw | ConvertFrom-Json; if ($Statuses -contains [string]$result.status) { return $result } }
        Start-Sleep 5
    } while ((Get-Date) -lt $deadline)
    throw "timed out waiting for worker: $ReleaseId"
}
function New-Zip([string]$Source,[string]$Target) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path $Target) { Remove-Item $Target -Force }
    [IO.Compression.ZipFile]::CreateFromDirectory($Source,$Target,[IO.Compression.CompressionLevel]::Optimal,$false)
}
function Test-ExternalFrontend {
    [xml]$sitemap = Get-Content (Join-Path $Dist 'sitemap.xml') -Raw
    foreach ($url in @($sitemap.SelectNodes("//*[local-name()='loc']") | ForEach-Object { $_.'#text'.Trim() })) {
        $headers = Join-Path $env:TEMP 'bts-release-headers.txt'
        $status = & curl.exe -sS -D $headers -o NUL -w '%{http_code}' $url
        if ($status -ne '200') { throw "external frontend health failed: $url -> $status" }
        if (Select-String -Path $headers -Pattern '^X-Robots-Tag:' -Quiet) { throw "production contains X-Robots-Tag: $url" }
    }
    $status = & curl.exe -sS -o NUL -w '%{http_code}' 'https://btsys.ru/api/health'
    if ($status -ne '200') { throw "external backend health failed: $status" }
    $missing = & curl.exe -sS -o NUL -w '%{http_code}' 'https://btsys.ru/__bts_release_probe_missing__'
    if ($missing -ne '404') { throw "external frontend 404 health failed: $missing" }
}

$Git = Get-Git
if (-not $Git) { throw 'git executable not found' }
if ((& $Git branch --show-current).Trim() -ne 'main') { throw 'current branch is not main' }
if (@(& $Git status --porcelain).Count -ne 0) { throw 'git working tree is not clean' }
$Head = (& $Git rev-parse HEAD).Trim()
& $Git fetch origin main --prune
if ($LASTEXITCODE -ne 0 -or $Head -ne (& $Git rev-parse origin/main).Trim()) { throw 'local HEAD differs from origin/main; pull manually and inspect staging' }
$FrontendTree = (& $Git rev-parse 'HEAD:dist').Trim()
$BackendTree = (& $Git rev-parse 'HEAD:backend').Trim()
if (-not (Test-Path $SshKey)) { throw "SSH key missing: $SshKey" }
$stateJson = Invoke-Ssh "powershell.exe -noprofile -command `"`$s='C:\ProgramData\BTS\deploy\state';[pscustomobject]@{frontend_tree=if(test-path (`$s+'\current-frontend-tree.txt')){(gc (`$s+'\current-frontend-tree.txt') -raw).trim()}else{''};frontend_commit=if(test-path (`$s+'\current-commit.txt')){(gc (`$s+'\current-commit.txt') -raw).trim()}else{''};backend_tree=if(test-path (`$s+'\current-backend-tree.txt')){(gc (`$s+'\current-backend-tree.txt') -raw).trim()}else{''}}|convertto-json -compress`""
$ProductionState = $stateJson | ConvertFrom-Json
$ProductionFrontendTree = [string]$ProductionState.frontend_tree
if (-not $ProductionFrontendTree -and [string]$ProductionState.frontend_commit -match '^[0-9a-f]{40}$') {
    $baselineTree = @(& $Git rev-parse "$($ProductionState.frontend_commit):dist" 2>$null)
    if ($LASTEXITCODE -eq 0 -and $baselineTree.Count -gt 0) { $ProductionFrontendTree = ($baselineTree -join '').Trim() }
}
$ProductionBackendTree = [string]$ProductionState.backend_tree
$FrontendChanged = $FrontendTree -ne $ProductionFrontendTree
$BackendChanged = $BackendTree -ne $ProductionBackendTree
Write-Host '=== COMPONENT STATE ==='
Write-Host "FRONTEND local=$FrontendTree production=$ProductionFrontendTree action=$(if($FrontendChanged){'DEPLOY'}else{'SKIP'})"
Write-Host "BACKEND  local=$BackendTree production=$ProductionBackendTree action=$(if($BackendChanged){'DEPLOY'}else{'SKIP'})"
if (-not $FrontendChanged -and -not $BackendChanged) { Write-Host '=== RELEASE RESULT ==='; Write-Host 'PASS: nothing changed; nothing uploaded'; return }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Preflight -BackendChanged:$BackendChanged
if ($LASTEXITCODE -ne 0) { throw 'preflight failed' }
if ((& $Git rev-parse HEAD).Trim() -ne $Head -or @(& $Git status --porcelain).Count -ne 0) { throw 'repository changed during preflight' }
& $Git fetch origin main --prune
if ($LASTEXITCODE -ne 0 -or $Head -ne (& $Git rev-parse origin/main).Trim()) { throw 'origin/main changed during preflight' }

$ReleaseId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')_$($Head.Substring(0,12))"
$OutDir = Join-Path $OutRoot $ReleaseId
New-Item -ItemType Directory $OutDir -Force | Out-Null
$components = [ordered]@{}
foreach ($name in @('frontend','backend')) {
    $changed = if ($name -eq 'frontend') { $FrontendChanged } else { $BackendChanged }
    $tree = if ($name -eq 'frontend') { $FrontendTree } else { $BackendTree }
    $entry = [ordered]@{ changed=$changed; tree=$tree; archive=''; sha256='' }
    if ($changed) {
        $archive = Join-Path $OutDir "$ReleaseId.$name.zip"
        if ($name -eq 'frontend') { New-Zip $Dist $archive }
        else {
            $stage = Join-Path $OutDir 'backend-package'
            New-Item -ItemType Directory $stage | Out-Null
            Copy-Item (Join-Path $Backend 'server.js'),(Join-Path $Backend 'package.json'),(Join-Path $Backend 'package-lock.json') $stage
            Copy-Item (Join-Path $Backend 'node_modules') $stage -Recurse
            New-Zip $stage $archive
        }
        $entry.archive = [IO.Path]::GetFileName($archive)
        $entry.sha256 = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $components[$name] = $entry
}
$manifest = [ordered]@{ release_id=$ReleaseId; commit=$Head; components=$components }
$request = Join-Path $OutDir "$ReleaseId.request.json"
[IO.File]::WriteAllText($request,($manifest|ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
if ($DryRun) { Write-Host "PASS: artifacts prepared in $OutDir; production unchanged"; return }

$scpArgs = @('-i',$SshKey,'-o','batchmode=yes','-o','connecttimeout=10')
foreach ($name in @('backend','frontend')) {
    $entry = $components[$name]
    if (-not $entry.changed) { Write-Host "$($name.ToUpper()): SKIPPED"; continue }
    $local = Join-Path $OutDir $entry.archive
    & scp.exe @scpArgs $local "${Remote}:C:/ProgramData/BTS/deploy/incoming/$($entry.archive)"
    if ($LASTEXITCODE -ne 0) { throw "$name archive upload failed" }
}
& scp.exe @scpArgs $request "${Remote}:C:/ProgramData/BTS/deploy/incoming/$([IO.Path]::GetFileName($request))"
if ($LASTEXITCODE -ne 0) { throw 'request-last upload failed' }
$result = Get-RemoteResult $ReleaseId @('deployed','rolled_back','failed')
if ($result.status -ne 'deployed') { throw "worker $($result.status): $($result.message)" }
try {
    $externalPassed = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try { Test-ExternalFrontend; $externalPassed = $true; break }
        catch { if ($attempt -eq 3) { throw }; Start-Sleep 5 }
    }
    if (-not $externalPassed) { throw 'external checks failed' }
}
catch {
    $rollback = Join-Path $OutDir "$ReleaseId.rollback.json"
    @{release_id=$ReleaseId;components=@{frontend=$FrontendChanged;backend=$BackendChanged}} | ConvertTo-Json -Depth 4 | Set-Content $rollback -Encoding UTF8
    & scp.exe @scpArgs $rollback "${Remote}:C:/ProgramData/BTS/deploy/incoming/$([IO.Path]::GetFileName($rollback))"
    if ($LASTEXITCODE -ne 0) { throw "external check failed and rollback upload failed: $($_.Exception.Message)" }
    $rollbackResult = Get-RemoteResult $ReleaseId @('rolled_back_external','rollback_request_failed')
    throw "external check failed; rollback=$($rollbackResult.status): $($_.Exception.Message)"
}
Write-Host '=== RELEASE RESULT ==='
Write-Host 'PASS'
