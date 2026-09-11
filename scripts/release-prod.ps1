param(
    [switch]$dryrun
)

$erroractionpreference = 'stop'

$repo = split-path -parent $psscriptroot
$dist = join-path $repo 'dist'
$preflight = join-path $repo 'scripts\preflight.ps1'
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

write-host ''
write-host '=== existing project preflight ==='

$powershell = "$env:windir\system32\windowspowershell\v1.0\powershell.exe"

& $powershell `
    -noprofile `
    -executionpolicy bypass `
    -file $preflight

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
write-host '=== package exact inspected dist ==='

$shortsha = $head.substring(0, 12)
$stamp = get-date -format 'yyyyMMdd-HHmmss'
$releaseid = "${stamp}_${shortsha}"

$outdir = join-path $outroot $releaseid
$archive = join-path $outdir "$releaseid.zip"
$request = join-path $outdir "$releaseid.request.json"
$rollbackrequest = join-path $outdir "$releaseid.rollback.json"

new-item -itemtype directory -path $outdir -force | out-null

add-type -assemblyname system.io.compression.filesystem

[io.compression.zipfile]::createfromdirectory(
    $dist,
    $archive,
    [io.compression.compressionlevel]::optimal,
    $false
)

$hash = (
    get-filehash -literalpath $archive -algorithm sha256
).hash.tolowerinvariant()

$files = @(
    get-childitem -literalpath $dist -file -recurse
)

$bytes = (
    $files |
    measure-object -property length -sum
).sum

$manifest = [pscustomobject]@{
    release_id = $releaseid
    commit = $head
    archive = [io.path]::getfilename($archive)
    sha256 = $hash
}

[io.file]::writealltext(
    $request,
    ($manifest | convertto-json),
    (new-object text.utf8encoding($false))
)

write-host "release id: $releaseid"
write-host "commit:     $head"
write-host "files:      $($files.count)"
write-host "dist bytes: $bytes"
write-host "archive:    $archive"
write-host "sha256:     $hash"

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

$remotearchive = "${remote}:C:/ProgramData/BTS/deploy/incoming/$([io.path]::getfilename($archive))"
$remoterequest = "${remote}:C:/ProgramData/BTS/deploy/incoming/$([io.path]::getfilename($request))"

# Upload the large immutable archive first.
& scp.exe @scpargs $archive $remotearchive

if ($lastexitcode -ne 0) {
    throw "archive upload failed: $lastexitcode"
}

write-host 'archive upload: pass'

# Upload the request last. Its appearance tells the production worker
# that the archive is complete and may be processed.
& scp.exe @scpargs $request $remoterequest

if ($lastexitcode -ne 0) {
    throw "request upload failed: $lastexitcode"
}

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