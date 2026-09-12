function New-BackendArtifact {
    param(
        [Parameter(Mandatory = $true)][string]$BackendSource,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [switch]$SkipInstall
    )
    if (-not $SkipInstall) {
        & npm.cmd ci --prefix $BackendSource --omit=dev
        if ($LASTEXITCODE -ne 0) { throw "backend npm ci failed: $LASTEXITCODE" }
    }
    if (-not (Test-Path (Join-Path $BackendSource 'node_modules'))) { throw 'backend production node_modules is missing' }
    Remove-Item $WorkingDirectory -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $WorkingDirectory -Force | Out-Null
    $excludeDirectories = @('tests','config','node_modules','.git')
    $excludeFiles = @('.env','.env.*','README.md','*.log','*.tmp','*.before-*')
    & robocopy.exe $BackendSource $WorkingDirectory /E /XD $excludeDirectories /XF $excludeFiles /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "backend runtime copy failed: $LASTEXITCODE" }
    Copy-Item (Join-Path $BackendSource 'node_modules') (Join-Path $WorkingDirectory 'node_modules') -Recurse
    Remove-Item $ArchivePath -Force -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($WorkingDirectory,$ArchivePath,[IO.Compression.CompressionLevel]::Optimal,$false)
    return $ArchivePath
}
