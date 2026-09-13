param(
    # This switch is used only while the release tooling itself is being installed.
    # Normal releases must never use it.
    [switch]$SkipGitClean,
    [switch]$BackendChanged
)

# Any unexpected PowerShell error must stop the validation process.
$ErrorActionPreference = 'Stop'

# The script lives in <repo>\scripts, so its parent is the repository root.
$Repo = Split-Path -Parent $PSScriptRoot

# The exact folder served by staging and later transferred to production.
$Dist = Join-Path $Repo 'dist'
$Backend = Join-Path $Repo 'backend'

# Reload the current registered Windows PATH values.
# This makes the script independent of an Explorer process with stale environment data.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')

# Keep every failure so one run reports all problems instead of stopping at the first one.
$Failures = New-Object System.Collections.Generic.List[string]

# Print a successful individual validation.
function Add-Pass {
    param([string]$Message)
    Write-Host "PASS: $Message"
}

# Record an individual validation failure.
function Add-Fail {
    param([string]$Message)
    $script:Failures.Add($Message)
    Write-Host "FAIL: $Message"
}

# Convert a condition into a consistent PASS/FAIL line.
function Assert-Check {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if ($Condition) {
        Add-Pass $Message
    }
    else {
        Add-Fail $Message
    }
}

Write-Host '=== BTS RELEASE PREFLIGHT ==='

# ---------------------------------------------------------------------------
# TOOLING
# ---------------------------------------------------------------------------

# Find Git inside the newest installed GitHub Desktop.
# Production does not need Git; this check runs only on the German staging server.
$Git = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" `
    -Filter 'git.exe' `
    -Recurse `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like '*\git\cmd\git.exe' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName

Assert-Check ([bool]$Git) 'Git executable found'

# Find npm after refreshing PATH.
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
Assert-Check ([bool]$NpmCommand) 'npm executable found'

# Do not continue into Git-specific checks when Git itself is missing.
if ($Git) {
    # Read the exact branch currently checked out locally.
    $Branch = (& $Git -C $Repo branch --show-current).Trim()

    # Read the exact commit currently represented by staging.
    $Commit = (& $Git -C $Repo rev-parse HEAD).Trim()

    Write-Host "Branch: $Branch"
    Write-Host "Commit: $Commit"

    # The intentionally simple BTS workflow currently uses only main.
    Assert-Check ($Branch -eq 'main') 'Current branch is main'

    # During a real release the repository must be byte-for-byte clean.
    # A newer remote GitHub commit is intentionally irrelevant until the user pulls it.
    if (-not $SkipGitClean) {
        $Changes = @(& $Git -C $Repo status --porcelain)
        Assert-Check ($Changes.Count -eq 0) 'Git working tree is clean'

        if ($Changes.Count -gt 0) {
            $Changes | ForEach-Object { Write-Host "  $_" }
        }
    }
    else {
        Write-Host 'INFO: Git clean check skipped for initial tooling setup only'
    }
}

# ---------------------------------------------------------------------------
# DIST STRUCTURE
# ---------------------------------------------------------------------------

Assert-Check (Test-Path $Dist) 'dist directory exists'
Assert-Check (Test-Path $Backend) 'backend directory exists'

# Backend is a separate deployable component and must never be copied into dist.
foreach ($BackendFile in @('server.js','start.js','package.json','package-lock.json')) {
    Assert-Check (Test-Path (Join-Path $Backend $BackendFile)) "Backend file exists: $BackendFile"
}
Add-Type -AssemblyName System.Web.Extensions
$JsonSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$JsonSerializer.MaxJsonLength = [int]::MaxValue

$BackendPackage = if (Test-Path (Join-Path $Backend 'package.json')) {
    $JsonSerializer.DeserializeObject((Get-Content (Join-Path $Backend 'package.json') -Raw))
}
else {
    $null
}

$BackendLock = if (Test-Path (Join-Path $Backend 'package-lock.json')) {
    $JsonSerializer.DeserializeObject((Get-Content (Join-Path $Backend 'package-lock.json') -Raw))
}
else {
    $null
}

if ($BackendPackage -and $BackendLock) {
    $PackageDependencyTable = $BackendPackage['dependencies']
    $LockPackages = $BackendLock['packages']
    $LockRoot = if ($LockPackages -and $LockPackages.ContainsKey('')) {
        $LockPackages['']
    }
    else {
        $null
    }
    $LockDependencyTable = if ($LockRoot) {
        $LockRoot['dependencies']
    }
    else {
        $null
    }

    $PackageDependencies = if ($PackageDependencyTable) {
        @(
            $PackageDependencyTable.GetEnumerator() |
            ForEach-Object { "$($_.Key)=$($_.Value)" } |
            Sort-Object
        )
    }
    else {
        @()
    }

    $LockDependencies = if ($LockDependencyTable) {
        @(
            $LockDependencyTable.GetEnumerator() |
            ForEach-Object { "$($_.Key)=$($_.Value)" } |
            Sort-Object
        )
    }
    else {
        @()
    }

    $DependencyMetadataOk =
        ($null -ne $PackageDependencyTable) -and
        ($null -ne $LockDependencyTable)

    Assert-Check (
        $DependencyMetadataOk -and
        (($PackageDependencies -join '|') -eq ($LockDependencies -join '|'))
    ) 'backend package.json and lockfile root dependencies agree'
}
Assert-Check (-not (Test-Path (Join-Path $Dist 'backend'))) 'backend is absent from dist'
Assert-Check (-not (Test-Path (Join-Path $Dist 'node_modules'))) 'node_modules is absent from dist'

$BackendServer = if (Test-Path (Join-Path $Backend 'server.js')) { Get-Content (Join-Path $Backend 'server.js') -Raw } else { '' }
Assert-Check ($BackendServer -match "app\.get\('/api/health'") 'backend health endpoint exists'
Assert-Check ($BackendServer -match "app\.post\('/api/contact'") 'backend contact endpoint exists'
Assert-Check ($BackendServer -match "app\.set\('trust proxy'") 'backend trust proxy is configured'
$CommittedSecretPattern = '(?im)^\s*(SMTP_PASS|PASSWORD|TOKEN|API_KEY)\s*=\s*\S+'
$BackendTextFiles = @(Get-ChildItem $Backend -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.Extension -in @('.js','.json','.xml','.txt','.example') })
$BackendSecretMatches = @($BackendTextFiles | Select-String -Pattern $CommittedSecretPattern -ErrorAction SilentlyContinue)
Assert-Check ($BackendSecretMatches.Count -eq 0) 'backend source contains no committed credential values'

if ($NpmCommand -and $BackendChanged) {
    Write-Host '=== BACKEND PREFLIGHT ==='
    & $NpmCommand.Source ci --prefix $Backend --omit=dev
    if ($LASTEXITCODE -eq 0) { Add-Pass 'backend package-lock is installable' } else { Add-Fail "backend npm ci failed: $LASTEXITCODE" }
    & node.exe --check (Join-Path $Backend 'server.js')
    if ($LASTEXITCODE -eq 0) { Add-Pass 'backend server.js syntax is valid' } else { Add-Fail 'backend server.js syntax is invalid' }
    & node.exe --check (Join-Path $Backend 'start.js')
    if ($LASTEXITCODE -eq 0) { Add-Pass 'backend start.js syntax is valid' } else { Add-Fail 'backend start.js syntax is invalid' }
    & $NpmCommand.Source test --prefix $Backend
    if ($LASTEXITCODE -eq 0) { Add-Pass 'backend tests passed' } else { Add-Fail "backend tests failed: $LASTEXITCODE" }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo 'scripts\test-backend-packaging.ps1')
    if ($LASTEXITCODE -eq 0) { Add-Pass 'backend recursive packaging test passed' } else { Add-Fail "backend packaging test failed: $LASTEXITCODE" }
}

# These files are mandatory for every production release.
$RequiredFiles = @(
    'index.html',
    'products\index.html',
    'faq\index.html',
    'about\index.html',
    'contacts\index.html',
    '404.html',
    'robots.txt',
    'sitemap.xml',
    'web.config',
    'mailru-verificationfc8f8bca4c54a0bd.html',
    'yandex_2b6b54d15f078bc5.html'
)

foreach ($RelativePath in $RequiredFiles) {
    Assert-Check `
        (Test-Path (Join-Path $Dist $RelativePath)) `
        "Required file exists: $RelativePath"
}

# BIMI is part of the public production artifact according to the project rules.
$BimiPath = Join-Path $Dist 'assets\bimi'
$BimiFiles = @()

if (Test-Path $BimiPath) {
    $BimiFiles = @(Get-ChildItem $BimiPath -File -Recurse -ErrorAction SilentlyContinue)
}

Assert-Check `
    ((Test-Path $BimiPath) -and $BimiFiles.Count -gt 0) `
    'BIMI public resources exist'

# ---------------------------------------------------------------------------
# FORBIDDEN STAGING CONTENT
# ---------------------------------------------------------------------------

# Scan only text formats to avoid interpreting binary images or videos as text.
$TextFiles = @(
    Get-ChildItem $Dist -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Extension -in @(
            '.html',
            '.htm',
            '.css',
            '.js',
            '.json',
            '.xml',
            '.txt',
            '.config',
            '.svg',
            '.map'
        )
    }
)

# These values must never appear anywhere in a production-ready dist.
$ForbiddenValues = @(
    'stage.btsys.ru',
    'localhost',
    '127.0.0.1',
    'C:\Users\'
)

foreach ($Value in $ForbiddenValues) {
    $Matches = @(
        $TextFiles |
        Select-String -SimpleMatch -Pattern $Value -ErrorAction SilentlyContinue
    )

    Assert-Check `
        ($Matches.Count -eq 0) `
        "dist does not contain forbidden value: $Value"
}

# The staging X-Robots-Tag must live only in applicationHost.config,
# never inside the transferable publication.
$HeaderMatches = @(
    $TextFiles |
    Select-String -SimpleMatch -Pattern 'X-Robots-Tag' -ErrorAction SilentlyContinue
)

Assert-Check `
    ($HeaderMatches.Count -eq 0) `
    'dist does not contain X-Robots-Tag'

# Production main pages must not contain noindex.
# The custom 404 page is intentionally excluded because noindex is correct there.
$NoIndexFiles = @(
    $TextFiles |
    Where-Object { $_.FullName -ne (Join-Path $Dist '404.html') } |
    Select-String -SimpleMatch -Pattern 'noindex' -ErrorAction SilentlyContinue
)

Assert-Check `
    ($NoIndexFiles.Count -eq 0) `
    'noindex is absent outside the custom 404 page'

# ---------------------------------------------------------------------------
# ROBOTS.TXT
# ---------------------------------------------------------------------------

$RobotsPath = Join-Path $Dist 'robots.txt'

if (Test-Path $RobotsPath) {
    $Robots = Get-Content $RobotsPath -Raw

    Assert-Check `
        ($Robots -match '(?im)^\s*User-agent:\s*\*\s*$') `
        'robots.txt contains User-agent: *'

    Assert-Check `
        ($Robots -match '(?im)^\s*Allow:\s*/\s*$') `
        'robots.txt allows the production site'

    Assert-Check `
        ($Robots -match '(?im)^\s*Sitemap:\s*https://btsys\.ru/sitemap\.xml\s*$') `
        'robots.txt points to production sitemap'

    Assert-Check `
        ($Robots -notmatch '(?im)^\s*Disallow:\s*/\s*$') `
        'robots.txt does not block the entire site'
}

# ---------------------------------------------------------------------------
# SITEMAP.XML
# ---------------------------------------------------------------------------

$ExpectedProductionUrls = @(
    'https://btsys.ru/',
    'https://btsys.ru/products/',
    'https://btsys.ru/faq/',
    'https://btsys.ru/about/',
    'https://btsys.ru/contacts/'
)

$SitemapPath = Join-Path $Dist 'sitemap.xml'

if (Test-Path $SitemapPath) {
    try {
        [xml]$SitemapXml = Get-Content $SitemapPath -Raw

        # local-name() avoids problems caused by the standard sitemap XML namespace.
        $SitemapUrls = @(
            $SitemapXml.SelectNodes("//*[local-name()='loc']") |
            ForEach-Object { $_.'#text'.Trim() }
        )

        foreach ($ExpectedUrl in $ExpectedProductionUrls) {
            Assert-Check `
                ($SitemapUrls -contains $ExpectedUrl) `
                "sitemap contains $ExpectedUrl"
        }

        # Every sitemap URL must point only to the canonical production origin.
        $WrongSitemapUrls = @(
            $SitemapUrls |
            Where-Object { $_ -notmatch '^https://btsys\.ru/' }
        )

        Assert-Check `
            ($WrongSitemapUrls.Count -eq 0) `
            'all sitemap URLs use https://btsys.ru/'
    }
    catch {
        Add-Fail "sitemap.xml is not valid XML: $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------------------
# CANONICAL URLS
# ---------------------------------------------------------------------------

$CanonicalPages = @(
    @{
        File = 'index.html'
        Url  = 'https://btsys.ru/'
    },
    @{
        File = 'products\index.html'
        Url  = 'https://btsys.ru/products/'
    },
    @{
        File = 'faq\index.html'
        Url  = 'https://btsys.ru/faq/'
    },
    @{
        File = 'about\index.html'
        Url  = 'https://btsys.ru/about/'
    },
    @{
        File = 'contacts\index.html'
        Url  = 'https://btsys.ru/contacts/'
    }
)

foreach ($Page in $CanonicalPages) {
    $FilePath = Join-Path $Dist $Page.File

    if (-not (Test-Path $FilePath)) {
        continue
    }

    $Html = Get-Content $FilePath -Raw

    # Find the canonical link tag regardless of attribute order.
    $CanonicalTag = [regex]::Match(
        $Html,
        '<link\b(?=[^>]*\brel=["'']canonical["''])[^>]*>',
        'IgnoreCase'
    )

    # Extract its href value.
    $CanonicalHref = ''

    if ($CanonicalTag.Success) {
        $HrefMatch = [regex]::Match(
            $CanonicalTag.Value,
            'href=["'']([^"'']+)["'']',
            'IgnoreCase'
        )

        if ($HrefMatch.Success) {
            $CanonicalHref = $HrefMatch.Groups[1].Value
        }
    }

    Assert-Check `
        ($CanonicalHref -eq $Page.Url) `
        "canonical is correct: $($Page.File)"
}

# ---------------------------------------------------------------------------
# REAL STAGING PLAYWRIGHT TESTS
# ---------------------------------------------------------------------------

if ($NpmCommand) {
    Write-Host ''
    Write-Host '=== PLAYWRIGHT STAGING TESTS ==='

    # Run the browser smoke tests against the actual HTTPS staging site.
    & $NpmCommand.Source run test:stage

    # npm forwards the Playwright exit code.
    if ($LASTEXITCODE -eq 0) {
        Add-Pass 'Playwright staging tests passed'
    }
    else {
        Add-Fail "Playwright staging tests failed with exit code $LASTEXITCODE"
    }
}

# ---------------------------------------------------------------------------
# FINAL RESULT
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host '=== PREFLIGHT RESULT ==='

if ($Failures.Count -eq 0) {
    Write-Host 'PASS'
    exit 0
}

Write-Host 'FAIL'

foreach ($Failure in $Failures) {
    Write-Host " - $Failure"
}

exit 1
