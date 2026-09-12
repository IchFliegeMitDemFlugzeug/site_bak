$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-package.ps1')
$Root = Join-Path $Repo '.release\packaging-test'
$Archive = Join-Path $Root 'backend.zip'
New-BackendArtifact -BackendSource (Join-Path $Repo 'backend') -WorkingDirectory (Join-Path $Root 'content') -ArchivePath $Archive -SkipInstall | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
    $names = @($zip.Entries | ForEach-Object FullName)
    if ($names -notcontains 'lib/runtime-marker.js') { throw 'nested runtime file was not packaged' }
    if ($names | Where-Object { $_ -match '^(tests|config)/|^\.env|README\.md$' }) { throw 'excluded development/security file was packaged' }
}
finally { $zip.Dispose() }
Write-Host 'PASS: recursive backend packaging preserves nested runtime and exclusions.'
