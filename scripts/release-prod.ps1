param(
    [switch]$dryrun
)

$erroractionpreference = 'stop'

$repo = split-path -parent $psscriptroot
$dist = join-path $repo 'dist'
$backend = join-path $repo 'backend'
$preflight = join-path $repo 'scripts\preflight.ps1'
$backendpackaging = join-path $repo 'scripts\backend-package.ps1'
$outroot = join-path $repo '.release'

$sshkey = 'c:\programdata\bts\ssh\bts_prod_ed25519'
$prodip = '135.106.194.75'
$deployuser = 'bts-deploy'
$remote = "${deployuser}@${prodip}"

$env:path = [environment]::getenvironmentvariable('path', 'machine') + ';' +
            [environment]::getenvironmentvariable('path', 'user')

set-location $repo

function get-git {
    return (
        get-childitem "$env:localappdata\githubdesktop" `
            -filter 'git.exe' `
            -recurse `
            -erroraction silentlycontinue |
        where-object { $_.fullname -like '*\git\cmd\git.exe' } |
        sort-object lastwritetime -descending |
        select-object -first 1 -expandproperty fullname
    )
}

function get-remote-result {
    param(
        [string]$releaseid,
        [string[]]$terminalstatuses,
        [int]$timeoutseconds = 240
    )

    $sshargs = @(
        '-i', $sshkey,
        '-o', 'batchmode=yes',
        '-o', 'connecttimeout=10'
    )

    $remotepath = "c:\programdata\bts\deploy\outbox\$releaseid.json"
    $deadline = (get-date).addseconds($timeoutseconds)

    do {
        $command = "powershell.exe -noprofile -command `"if (test-path -literalpath '$remotepath') { get-content -literalpath '$remotepath' -raw }`""

        $raw = @(
            & ssh.exe @sshargs $remote $command
        )

        if ($lastexitcode -ne 0) {
            throw "ssh failed while reading deployment result: $lastexitcode"
        }

        if ($raw.count -gt 0) {
            $text = ($raw -join "`n").trim()

            if ($text) {
                try {
                    $result = $text | convertfrom-json

                    if ($terminalstatuses -contains [string]$result.status) {
                        return $result
                    }
                }
                catch {
                    # The worker may be replacing the result file.
                    # Retry until timeout instead of treating a partial read as final.
                }
            }
        }

        start-sleep -seconds 5
    }
    while ((get-date) -lt $deadline)

    throw "timed out waiting for production worker result for $releaseid"
}

function get-http-result {
    param([string]$url)

    $request = [system.net.httpwebrequest]::create($url)
    $request.method = 'GET'
    $request.allowautoredirect = $true
    $request.timeout = 20000
    $request.readwritetimeout = 20000
    $response = $null

    try {
        $response = $request.getresponse()
    }
    catch [system.net.webexception] {
        if ($_.exception.response) {
            $response = $_.exception.response
        }
        else {
            throw
        }
    }

    try {
        return [pscustomobject]@{
            status = [int]$response.statuscode
            xrobots = [string]$response.headers['x-robots-tag']
        }
    }
    finally {
        if ($response) {
            $response.close()
        }
    }
}

function test-external-production {
    param([string[]]$urls)

    foreach ($url in $urls) {
        $result = get-http-result $url

        if ($result.status -ne 200) {
            throw "external check failed: $url -> $($result.status)"
        }

        if ($result.xrobots) {
            throw "production contains x-robots-tag: $url -> $($result.xrobots)"
        }

        write-host "pass: $url -> 200"
    }

    $missing = 'https://btsys.ru/__bts_release_probe_missing__'
    $missingresult = get-http-result $missing

    if ($missingresult.status -ne 404) {
        throw "external 404 check failed: $($missingresult.status)"
    }

    write-host "pass: production 404 -> 404"

    $backendhealth = get-http-result 'https://btsys.ru/api/health'
    if ($backendhealth.status -ne 200) { throw "external backend health failed: $($backendhealth.status)" }
    write-host 'pass: production backend health -> 200'
}

write-host '=== release precheck ==='

$git = get-git

if (-not $git) {
    throw 'git executable not found'
}

if (-not (test-path $dist)) {
    throw 'dist directory not found'
}

if (-not (test-path $preflight)) {
    throw 'preflight script not found'
}

$branch = (& $git branch --show-current).trim()

if ($branch -ne 'main') {
    throw "wrong branch: $branch"
}

$changes = @(& $git status --porcelain)

if ($changes.count -ne 0) {
    write-host 'git changes:'
    $changes | foreach-object { write-host "  $_" }
    throw 'git working tree is not clean'
}

$head = (& $git rev-parse head).trim()

write-host "local head: $head"

write-host ''
write-host '=== github check before preflight ==='

& $git fetch origin main --prune

if ($lastexitcode -ne 0) {
    throw "git fetch failed: $lastexitcode"
}

$remotehead = (& $git rev-parse origin/main).trim()

write-host "remote head: $remotehead"

if ($head -ne $remotehead) {
    throw 'local main differs from origin/main. use github desktop pull and inspect staging again'
}

write-host 'github state: pass'

# Exact DEPLOY/SKIP requires the production component state. DryRun performs this
# read-only SSH query too, so Selectel VPN must be disabled for a precise plan.
if (-not (test-path $sshkey)) {
    throw "ssh private key not found: $sshkey"
}

$sshargs = @(
    '-i', $sshkey,
    '-o', 'batchmode=yes',
    '-o', 'connecttimeout=10'
)

& ssh.exe @sshargs $remote 'cmd.exe /d /c exit 0'

if ($lastexitcode -ne 0) {
    throw 'production ssh is unavailable. DryRun and live release require it for component state; disable AmneziaVPN on Selectel'
}

$frontendtree = (& $git rev-parse 'HEAD:dist').trim()
$backendtree = (& $git rev-parse 'HEAD:backend').trim()
$statecommand = "powershell.exe -noprofile -command `"`$s='C:\ProgramData\BTS\deploy\state';[pscustomobject]@{frontend_tree=if(test-path (`$s+'\current-frontend-tree.txt')){(gc (`$s+'\current-frontend-tree.txt') -raw).trim()}else{''};frontend_commit=if(test-path (`$s+'\current-commit.txt')){(gc (`$s+'\current-commit.txt') -raw).trim()}else{''};backend_tree=if(test-path (`$s+'\current-backend-tree.txt')){(gc (`$s+'\current-backend-tree.txt') -raw).trim()}else{''}}|convertto-json -compress`""
$productionstatejson = @(& ssh.exe @sshargs $remote $statecommand)

if ($lastexitcode -ne 0 -or $productionstatejson.count -eq 0) {
    throw 'production component state could not be read'
}

$productionstate = ($productionstatejson -join "`n") | convertfrom-json
$productionfrontendtree = [string]$productionstate.frontend_tree

if (-not $productionfrontendtree -and [string]$productionstate.frontend_commit -match '^[0-9a-f]{40}$') {
    $legacytree = @(& $git rev-parse "$($productionstate.frontend_commit):dist" 2>$null)
    if ($lastexitcode -eq 0 -and $legacytree.count -gt 0) {
        $productionfrontendtree = ($legacytree -join '').trim()
    }
}

$productionbackendtree = [string]$productionstate.backend_tree
$frontendchanged = $frontendtree -ne $productionfrontendtree
$backendchanged = $backendtree -ne $productionbackendtree

write-host ''
write-host '=== component state ==='
write-host "FRONTEND local:      $frontendtree"
write-host "FRONTEND production: $productionfrontendtree"
write-host "FRONTEND action:     $(if ($frontendchanged) { 'DEPLOY' } else { 'SKIP' })"
write-host "BACKEND local:       $backendtree"
write-host "BACKEND production:  $productionbackendtree"
write-host "BACKEND action:      $(if ($backendchanged) { 'DEPLOY' } else { 'SKIP' })"

if (-not $frontendchanged -and -not $backendchanged) {
    write-host 'PASS: nothing changed'
    return
}

write-host ''
write-host '=== existing project preflight ==='

$powershell = "$env:windir\system32\windowspowershell\v1.0\powershell.exe"

& $powershell `
    -noprofile `
    -executionpolicy bypass `
    -file $preflight `
    -BackendChanged:$backendchanged

if ($lastexitcode -ne 0) {
    throw "project preflight failed: $lastexitcode"
}

write-host ''
write-host '=== final git check ==='

$currenthead = (& $git rev-parse head).trim()

if ($currenthead -ne $head) {
    throw 'local commit changed during preflight'
}

$changes = @(& $git status --porcelain)

if ($changes.count -ne 0) {
    write-host 'git changes after preflight:'
    $changes | foreach-object { write-host "  $_" }
    throw 'working tree changed during preflight'
}

& $git fetch origin main --prune

if ($lastexitcode -ne 0) {
    throw "final git fetch failed: $lastexitcode"
}

$finalremotehead = (& $git rev-parse origin/main).trim()

if ($head -ne $finalremotehead) {
    throw 'origin/main changed during preflight. pull manually and inspect staging again'
}

write-host 'final git state: pass'

write-host ''
write-host '=== package changed components ==='

$shortsha = $head.substring(0, 12)
$stamp = get-date -format 'yyyyMMdd-HHmmss'
$releaseid = "${stamp}_${shortsha}"
$outdir = join-path $outroot $releaseid
$request = join-path $outdir "$releaseid.request.json"
$rollbackrequest = join-path $outdir "$releaseid.rollback.json"
new-item -itemtype directory -path $outdir -force | out-null
add-type -assemblyname system.io.compression.filesystem

$components = [ordered]@{}
$frontendarchive = $null
$backendarchive = $null

if ($frontendchanged) {
    $frontendarchive = join-path $outdir "$releaseid.frontend.zip"
    [io.compression.zipfile]::createfromdirectory($dist,$frontendarchive,[io.compression.compressionlevel]::optimal,$false)
    $components.frontend = [ordered]@{
        changed = $true
        tree = $frontendtree
        archive = [io.path]::getfilename($frontendarchive)
        sha256 = (get-filehash $frontendarchive -algorithm sha256).hash.tolowerinvariant()
    }
    write-host "FRONTEND archive: $frontendarchive"
}
else {
    $components.frontend = [ordered]@{ changed=$false; tree=$frontendtree; archive=''; sha256='' }
    write-host 'FRONTEND packaging: SKIPPED'
}

if ($backendchanged) {
    . $backendpackaging
    $backendarchive = join-path $outdir "$releaseid.backend.zip"
    New-BackendArtifact -BackendSource $backend -WorkingDirectory (join-path $outdir 'backend-runtime') -ArchivePath $backendarchive -SkipInstall | out-null
    $components.backend = [ordered]@{
        changed = $true
        tree = $backendtree
        archive = [io.path]::getfilename($backendarchive)
        sha256 = (get-filehash $backendarchive -algorithm sha256).hash.tolowerinvariant()
    }
    write-host "BACKEND archive: $backendarchive"
}
else {
    $components.backend = [ordered]@{ changed=$false; tree=$backendtree; archive=''; sha256='' }
    write-host 'BACKEND packaging: SKIPPED'
}

$manifest = [ordered]@{
    release_id = $releaseid
    commit = $head
    components = $components
}

[io.file]::writealltext($request,($manifest | convertto-json -depth 6),(new-object text.utf8encoding($false)))
write-host "release id: $releaseid"
write-host "commit:     $head"
write-host "request:    $request"

if ($dryrun) {
    write-host ''
    write-host '=== dry run result ==='
    write-host 'pass'
    write-host 'nothing was uploaded to production'
    return
}

write-host ''
write-host '=== production transport check ==='
write-host 'selectel vpn must be disabled for this step'

if (-not (test-path $sshkey)) {
    throw "ssh private key not found: $sshkey"
}

$sshargs = @(
    '-i', $sshkey,
    '-o', 'batchmode=yes',
    '-o', 'connecttimeout=10'
)

& ssh.exe @sshargs $remote 'cmd.exe /d /c exit 0'

if ($lastexitcode -ne 0) {
    throw 'production ssh is unavailable. disable amneziavpn on selectel and run the release again'
}

write-host 'production ssh: pass'

write-host ''
write-host '=== upload release ==='

$scpargs = @(
    '-i', $sshkey,
    '-o', 'batchmode=yes',
    '-o', 'connecttimeout=10'
)

# Every changed component archive is uploaded first. An unchanged component
# has no archive and therefore causes no production-side activity.
foreach ($componentname in @('backend','frontend')) {
    $component = $components[$componentname]
    if (-not $component.changed) {
        write-host "$($componentname.toupper()) upload: SKIPPED"
        continue
    }
    $localarchive = join-path $outdir $component.archive
    $remotearchive = "${remote}:C:/ProgramData/BTS/deploy/incoming/$($component.archive)"
    & scp.exe @scpargs $localarchive $remotearchive
    if ($lastexitcode -ne 0) { throw "$componentname archive upload failed: $lastexitcode" }
    write-host "$($componentname.toupper()) archive upload: pass"
}

$remoterequest = "${remote}:C:/ProgramData/BTS/deploy/incoming/$([io.path]::getfilename($request))"
# Request is deliberately last, so the worker cannot observe partial artifacts.
& scp.exe @scpargs $request $remoterequest
if ($lastexitcode -ne 0) { throw "request upload failed: $lastexitcode" }
write-host 'request upload: pass'

write-host ''
write-host '=== wait for production worker ==='

$result = get-remote-result `
    -releaseid $releaseid `
    -terminalstatuses @('deployed','rolled_back','failed') `
    -timeoutseconds 240

write-host "worker status: $($result.status)"
write-host "worker message: $($result.message)"

if ($result.status -eq 'rolled_back') {
    throw "production worker rejected the release and restored the previous version: $($result.message)"
}

if ($result.status -ne 'deployed') {
    throw "production deployment failed: $($result.message)"
}

write-host ''
write-host '=== external production checks ==='

[xml]$sitemap = get-content `
    -literalpath (join-path $dist 'sitemap.xml') `
    -raw

$urls = @(
    $sitemap.selectnodes("//*[local-name()='loc']") |
    foreach-object { $_.'#text'.trim() }
)

if ($urls.count -lt 1) {
    throw 'no urls found in local sitemap'
}

$externalok = $false
$externalerror = ''

for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
        write-host "external check attempt: $attempt/3"

        test-external-production $urls

        $externalok = $true
        break
    }
    catch {
        $externalerror = $_.exception.message
        write-host "external check failed: $externalerror"

        if ($attempt -lt 3) {
            start-sleep -seconds 5
        }
    }
}

if (-not $externalok) {
    write-host ''
    write-host '=== automatic rollback request ==='

    $rollback = [pscustomobject]@{
        release_id = $releaseid
        components = [pscustomobject]@{ frontend = $frontendchanged; backend = $backendchanged }
    }

    [io.file]::writealltext(
        $rollbackrequest,
        ($rollback | convertto-json),
        (new-object text.utf8encoding($false))
    )

    $remoterollback = "${remote}:C:/ProgramData/BTS/deploy/incoming/$([io.path]::getfilename($rollbackrequest))"

    & scp.exe @scpargs $rollbackrequest $remoterollback

    if ($lastexitcode -ne 0) {
        throw "critical: external checks failed and rollback request upload also failed: $externalerror"
    }

    write-host 'rollback request uploaded'

    $rollbackresult = get-remote-result `
        -releaseid $releaseid `
        -terminalstatuses @(
            'rolled_back_external',
            'rollback_failed',
            'rollback_request_failed'
        ) `
        -timeoutseconds 240

    write-host "rollback status: $($rollbackresult.status)"
    write-host "rollback message: $($rollbackresult.message)"

    if ($rollbackresult.status -eq 'rolled_back_external') {
        throw "release failed external checks and was automatically rolled back: $externalerror"
    }

    throw "critical rollback failure: $($rollbackresult.message)"
}

write-host ''
write-host '=== release result ==='
write-host 'pass'
write-host "production release: $releaseid"
write-host "production commit:  $head"
write-host 'server checks: pass'
write-host 'external checks: pass'
