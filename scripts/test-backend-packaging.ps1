$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-package.ps1')

$Root = Join-Path $Repo '.release\packaging-test'
$Archive = Join-Path $Root 'backend.zip'

New-BackendArtifact `
    -BackendSource (Join-Path $Repo 'backend') `
    -WorkingDirectory (Join-Path $Root 'content') `
    -ArchivePath $Archive `
    -SkipInstall | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [IO.Compression.ZipFile]::OpenRead($Archive)

try {
    $names = @(
        $zip.Entries |
        ForEach-Object { $_.FullName.Replace('\','/') }
    )

    if ($names -notcontains 'lib/runtime-marker.js') {
        throw 'nested runtime file was not packaged'
    }

    if ($names | Where-Object {
        $_ -match '^(tests|config)/|^\.env(?:$|\.)|^README\.md$'
    }) {
        throw 'excluded development/security file was packaged'
    }

    if (-not ($names | Where-Object { $_ -like 'node_modules/*' })) {
        throw 'node_modules was not packaged'
    }

    if ($names -notcontains 'server.js') {
        throw 'server.js was not packaged'
    }

    if ($names -notcontains 'start.js') {
        throw 'start.js was not packaged'
    }
}
finally {
    $zip.Dispose()
}

Write-Host 'PASS: recursive backend packaging preserves runtime files and exclusions.'