param(
    [switch]$dryrun
)

$erroractionpreference = 'stop'

$repo = split-path -parent $psscriptroot
$dist = join-path $repo 'dist'
$preflight = join-path $repo 'scripts\preflight.ps1'
$outroot = join-path $repo '.release'

$env:path = [environment]::getenvironmentvariable('path', 'machine') + ';' +
            [environment]::getenvironmentvariable('path', 'user')

write-host '=== release precheck ==='

$git = get-childitem "$env:localappdata\githubdesktop" `
    -filter 'git.exe' `
    -recurse `
    -erroraction silentlycontinue |
    where-object { $_.fullname -like '*\git\cmd\git.exe' } |
    sort-object lastwritetime -descending |
    select-object -first 1 -expandproperty fullname

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
    throw 'local main is not equal to origin/main. use github desktop pull and inspect staging again before release'
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

# Fetch again because github may have changed while playwright was running.
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

$json = $manifest | convertto-json

[io.file]::writealltext(
    $request,
    $json,
    (new-object text.utf8encoding($false))
)

write-host "release id: $releaseid"
write-host "commit:     $head"
write-host "files:      $($files.count)"
write-host "dist bytes: $bytes"
write-host "archive:    $archive"
write-host "sha256:     $hash"
write-host "request:    $request"

if ($dryrun) {
    write-host ''
    write-host '=== dry run result ==='
    write-host 'pass'
    write-host 'nothing was uploaded to production'
    return
}

throw 'live release is intentionally disabled until automatic external-check rollback is installed'