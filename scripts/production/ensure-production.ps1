param(
    [switch]$CheckOnly,
    [string]$WorkerSource,
    [string]$ServiceConfigSource,
    [string]$WinSWSource,
    [string]$ExpectedWorkerHash,
    [string]$ExpectedEnsureHash
)

$ErrorActionPreference = 'Stop'
$SchemaVersion = '2'
$SiteName = 'BTS'
$TaskPath = '\bts\'
$TaskName = 'bts deploy worker'
$ServiceName = 'BTSContactApi'
$NodePath = 'C:\Program Files\nodejs\node.exe'
$AppCmd = "$env:windir\system32\inetsrv\appcmd.exe"
$DeployRoot = 'C:\ProgramData\BTS\deploy'
$WorkerTarget = Join-Path $DeployRoot 'worker.ps1'
$EnsureTarget = Join-Path $DeployRoot 'ensure-production.ps1'
$StateRoot = Join-Path $DeployRoot 'state'
$ServiceRoot = 'C:\ProgramData\BTS\contact-api'
$ServiceExe = Join-Path $ServiceRoot 'BTSContactApi.exe'
$ServiceXml = Join-Path $ServiceRoot 'BTSContactApi.xml'
$BackendReleases = 'C:\Sites\BTS\backend-releases'
$BackendCurrent = 'C:\Sites\BTS\backend-current'
$RuleName = 'BTS API reverse proxy'
$RulePattern = '^api/(.*)$'
$RuleTarget = 'http://127.0.0.1:3001/api/{R:1}'
$RequiredDirectories = @(
    $BackendReleases,
    $ServiceRoot,
    (Join-Path $ServiceRoot 'logs'),
    $DeployRoot,
    (Join-Path $DeployRoot 'incoming'),
    (Join-Path $DeployRoot 'outbox'),
    (Join-Path $DeployRoot 'logs'),
    $StateRoot,
    (Join-Path $StateRoot 'processed')
)

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-BackendHealth {
    if (-not (Test-Path -LiteralPath (Join-Path $BackendCurrent 'server.js'))) { return $false }
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 10
        return $response.StatusCode -eq 200 -and $response.Content.Trim() -ceq '{"ok":true}'
    }
    catch { return $false }
}

function Test-RecurringTrigger {
    param([xml]$TaskXml)
    $namespace = New-Object Xml.XmlNamespaceManager($TaskXml.NameTable)
    $namespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    foreach ($trigger in @($TaskXml.SelectNodes('/t:Task/t:Triggers/*', $namespace))) {
        $enabled = $trigger.SelectSingleNode('t:Enabled', $namespace)
        $interval = $trigger.SelectSingleNode('t:Repetition/t:Interval', $namespace)
        $endBoundary = $trigger.SelectSingleNode('t:EndBoundary', $namespace)
        if ($enabled -and $enabled.InnerText -eq 'false') { continue }
        if (-not $interval) { continue }
        if ($endBoundary -and [datetime]$endBoundary.InnerText -lt (Get-Date)) { continue }
        try {
            $duration = [Xml.XmlConvert]::ToTimeSpan($interval.InnerText)
            if ($duration.TotalMinutes -ge 1 -and $duration.TotalMinutes -le 15) { return $true }
        }
        catch { }
    }
    return $false
}

function Set-RequiredAcl {
    param([string]$Path,[string]$Permission,[switch]$Inherit)
    $grant = if ($Inherit) { '*S-1-5-19:(OI)(CI)' + $Permission } else { '*S-1-5-19:' + $Permission }
    & icacls.exe $Path /grant $grant | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not grant LocalService $Permission on $Path" }
}

function Get-RuleState {
    $filter = "system.webServer/rewrite/rules/rule[@name='$RuleName']"
    $rule = Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter $filter -Name '.' -ErrorAction SilentlyContinue
    if (-not $rule) { return [pscustomobject]@{ Present=$false; Correct=$false } }
    $pattern = [string](Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter "$filter/match" -Name 'url').Value
    $target = [string](Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter "$filter/action" -Name 'url').Value
    $action = [string](Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter "$filter/action" -Name 'type').Value
    return [pscustomobject]@{ Present=$true; Correct=($pattern -ceq $RulePattern -and $target -ceq $RuleTarget -and $action -eq 'Rewrite') }
}

function Get-InfrastructureState {
    Import-Module WebAdministration -ErrorAction Stop
    $nodeOk = Test-Path -LiteralPath $NodePath
    $iisOk = (Test-Path -LiteralPath $AppCmd) -and [bool](Get-Website -Name $SiteName -ErrorAction SilentlyContinue)
    $rewriteOk = [bool](Get-WebGlobalModule -Name 'RewriteModule' -ErrorAction SilentlyContinue)
    $arrSection = Get-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -ErrorAction SilentlyContinue
    $arrOk = $null -ne $arrSection
    $arrEnabled = $arrOk -and [bool]$arrSection.enabled
    $smtpNames = @('SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','CONTACT_TO')
    $missingSmtp = @($smtpNames | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_, 'Machine')) })
    $smtpPortText = [Environment]::GetEnvironmentVariable('SMTP_PORT', 'Machine')
    $smtpPort = 0
    $smtpPortOk = [int]::TryParse($smtpPortText, [ref]$smtpPort) -and $smtpPort -ge 1 -and $smtpPort -le 65535
    $directoriesOk = @($RequiredDirectories | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -eq 0
    $workerOk = $false
    if ($WorkerSource -and (Test-Path -LiteralPath $WorkerSource) -and (Test-Path -LiteralPath $WorkerTarget)) {
        $sourceWorkerHash = (Get-FileHash $WorkerSource -Algorithm SHA256).Hash
        $workerOk = $sourceWorkerHash -eq (Get-FileHash $WorkerTarget -Algorithm SHA256).Hash -and
            (-not $ExpectedWorkerHash -or $sourceWorkerHash -eq $ExpectedWorkerHash)
    }
    $ensureOk = (Test-Path -LiteralPath $EnsureTarget) -and
        (-not $ExpectedEnsureHash -or (Get-FileHash $EnsureTarget -Algorithm SHA256).Hash -eq $ExpectedEnsureHash)
    $task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
    $taskOk = $false
    if ($task -and $task.Actions.Count -eq 1) {
        $taskAction = $task.Actions[0]
        [xml]$taskXml = Export-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
        $taskOk = $taskAction.Execute -match '(?i)powershell(?:\.exe)?$' -and
            $taskAction.Arguments -like "*$WorkerTarget*" -and
            [string]$task.Principal.UserId -match '^(SYSTEM|NT AUTHORITY\\SYSTEM)$' -and
            [string]$task.Principal.RunLevel -eq 'Highest' -and
            $task.State -ne 'Disabled' -and
            (Test-RecurringTrigger $taskXml)
    }
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    $serviceRecord = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    $serviceInstalled = $null -ne $service
    $serviceConfigOk = $serviceInstalled -and (Test-Path -LiteralPath $ServiceExe) -and
        (Test-Path -LiteralPath $ServiceXml) -and [string]$serviceRecord.StartName -eq 'NT AUTHORITY\LocalService'
    $backendPresent = Test-Path -LiteralPath (Join-Path $BackendCurrent 'server.js')
    $backendHealthy = Test-BackendHealth
    $serviceReady = if ($backendPresent) { $serviceConfigOk -and $service.StartType -eq 'Automatic' -and $service.Status -eq 'Running' -and $backendHealthy } else { $serviceConfigOk }
    $rule = Get-RuleState
    $proxyReady = $backendHealthy -and $arrEnabled -and $rule.Correct
    $schemaOk = (Test-Path (Join-Path $StateRoot 'deployment-schema-version.txt')) -and ((Get-Content (Join-Path $StateRoot 'deployment-schema-version.txt') -Raw).Trim() -eq $SchemaVersion)
    $frontendTree = if (Test-Path (Join-Path $StateRoot 'current-frontend-tree.txt')) { (Get-Content (Join-Path $StateRoot 'current-frontend-tree.txt') -Raw).Trim() } else { '' }
    $frontendCommit = if (Test-Path (Join-Path $StateRoot 'current-commit.txt')) { (Get-Content (Join-Path $StateRoot 'current-commit.txt') -Raw).Trim() } else { '' }
    $backendTree = if (Test-Path (Join-Path $StateRoot 'current-backend-tree.txt')) { (Get-Content (Join-Path $StateRoot 'current-backend-tree.txt') -Raw).Trim() } else { '' }
    $prerequisitesOk = $nodeOk -and $iisOk -and $rewriteOk -and $arrOk -and $missingSmtp.Count -eq 0 -and $smtpPortOk
    $reconcile = -not ($directoriesOk -and $workerOk -and $ensureOk -and $taskOk -and $serviceReady -and $schemaOk -and $arrEnabled -and ($proxyReady -or -not $backendHealthy))
    return [ordered]@{
        node=$nodeOk; iis=$iisOk; url_rewrite=$rewriteOk; arr=$arrOk; arr_enabled=$arrEnabled
        smtp_environment=($missingSmtp.Count -eq 0 -and $smtpPortOk); missing_smtp=$missingSmtp; smtp_port=$smtpPortOk
        directories=$directoriesOk; worker=$workerOk; ensure=$ensureOk; scheduled_task=$taskOk
        service_installed=$serviceInstalled; service_ready=$serviceReady
        backend_present=$backendPresent; backend_health=$backendHealthy; api_proxy=$proxyReady
        schema=$schemaOk; prerequisites=$prerequisitesOk; reconcile_required=$reconcile
        frontend_tree=$frontendTree; frontend_commit=$frontendCommit; backend_tree=$backendTree
    }
}

function Write-StateSummary($State) {
    function Label([bool]$Ok, [string]$Bad) { if ($Ok) { 'PASS' } else { $Bad } }
    Write-Host 'Production infrastructure:'
    Write-Host "Node ................ $(Label $State.node 'MISSING')"
    Write-Host "IIS ................. $(Label $State.iis 'MISSING')"
    Write-Host "URL Rewrite ......... $(Label $State.url_rewrite 'MISSING')"
    Write-Host "ARR ................. $(Label $State.arr 'MISSING')"
    Write-Host "Worker .............. $(Label $State.worker 'UPDATE REQUIRED')"
    Write-Host "Scheduled Task ...... $(Label $State.scheduled_task 'REPAIR REQUIRED')"
    Write-Host "BTSContactApi ....... $(if (-not $State.service_installed) { 'MISSING' } elseif ($State.service_ready) { 'PASS' } else { 'REPAIR REQUIRED' })"
    Write-Host "API proxy ........... $(if ($State.api_proxy) { 'PASS' } elseif ($State.backend_health) { 'REPAIR REQUIRED' } else { 'NOT READY' })"
    Write-Host "SMTP environment .... $(Label $State.smtp_environment 'MISSING')"
    Write-Host "Infrastructure action: $(if ($State.reconcile_required) { 'RECONCILE' } else { 'PASS' })"
}

$before = Get-InfrastructureState
Write-StateSummary $before
if (-not $before.prerequisites) {
    $missing = @()
    if (-not $before.node) { $missing += 'Node.js' }
    if (-not $before.iis) { $missing += 'IIS site BTS' }
    if (-not $before.url_rewrite) { $missing += 'IIS URL Rewrite' }
    if (-not $before.arr) { $missing += 'IIS ARR' }
    if (-not $before.smtp_environment) { $missing += "machine environment: $($before.missing_smtp -join ', ')" }
    if (-not $before.smtp_port) { $missing += 'SMTP_PORT must be an integer from 1 through 65535' }
    throw "Base prerequisites are missing: $($missing -join '; '). No production changes were made."
}
if ($CheckOnly) {
    [pscustomobject]$before | ConvertTo-Json -Compress
    return
}
if (-not (Test-Administrator)) { throw 'Infrastructure reconcile must run as Administrator/SYSTEM.' }
foreach ($path in $RequiredDirectories) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
foreach ($asset in @($WorkerSource,$ServiceConfigSource,$WinSWSource)) {
    if (-not $asset -or -not (Test-Path -LiteralPath $asset)) { throw "Required infrastructure asset is missing: $asset" }
}
if (-not (Test-Path $WorkerTarget) -or (Get-FileHash $WorkerSource -Algorithm SHA256).Hash -ne (Get-FileHash $WorkerTarget -Algorithm SHA256).Hash) {
    Copy-Item -LiteralPath $WorkerSource -Destination $WorkerTarget -Force
}
$task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
$desiredAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WorkerTarget`""
if (-not $task) {
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Action $desiredAction -Trigger $trigger -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
}
elseif (-not $before.scheduled_task) {
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 1)
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Set-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Action $desiredAction -Trigger $trigger -Principal $taskPrincipal | Out-Null
    Enable-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName | Out-Null
}
$backendPresent = Test-Path -LiteralPath (Join-Path $BackendCurrent 'server.js')
$xml = Get-Content -LiteralPath $ServiceConfigSource -Raw
if (-not $backendPresent) { $xml = $xml.Replace('<startmode>Automatic</startmode>','<startmode>Manual</startmode>') }
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$winSWChanged = -not (Test-Path $ServiceExe) -or (Get-FileHash $WinSWSource -Algorithm SHA256).Hash -ne (Get-FileHash $ServiceExe -Algorithm SHA256).Hash
if ($winSWChanged -and $service -and $service.Status -eq 'Running') { Stop-Service -Name $ServiceName -Force }
if ($winSWChanged) { Copy-Item -LiteralPath $WinSWSource -Destination $ServiceExe -Force }
if (-not (Test-Path $ServiceXml) -or (Get-Content $ServiceXml -Raw) -cne $xml) {
    [IO.File]::WriteAllText($ServiceXml, $xml, (New-Object Text.UTF8Encoding($false)))
}
$serviceRecord = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
if ($serviceRecord -and ($serviceRecord.PathName -notlike "*$ServiceExe*" -or $serviceRecord.StartName -ne 'NT AUTHORITY\LocalService')) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    for ($attempt = 0; $attempt -lt 20 -and (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue); $attempt++) { Start-Sleep -Milliseconds 250 }
    $service = $null
}
if (-not $service) { & $ServiceExe install | Out-Null; $service = Get-Service -Name $ServiceName }
$service = Get-Service -Name $ServiceName
Set-RequiredAcl -Path $BackendReleases -Permission 'RX' -Inherit
if (Test-Path -LiteralPath $BackendCurrent) { Set-RequiredAcl -Path $BackendCurrent -Permission 'RX' -Inherit }
Set-RequiredAcl -Path $ServiceRoot -Permission 'RX' -Inherit
Set-RequiredAcl -Path (Join-Path $ServiceRoot 'logs') -Permission 'M' -Inherit
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled -Value $true
if ($backendPresent) {
    Set-Service -Name $ServiceName -StartupType Automatic
    if ($service.Status -ne 'Running') { Start-Service -Name $ServiceName }
    sc.exe failure $ServiceName reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
    if (-not (Test-BackendHealth)) { throw 'Backend exists but strict local health check failed; public API proxy was not enabled.' }
    $filter = 'system.webServer/rewrite/rules'
    $oldRule = Get-RuleState
    if ($oldRule.Present -and -not $oldRule.Correct) { Remove-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter $filter -Name '.' -AtElement @{name=$RuleName} }
    if (-not (Get-RuleState).Present) {
        Add-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter $filter -Name '.' -Value @{name=$RuleName;patternSyntax='ECMAScript';stopProcessing='True'}
        Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter "$filter/rule[@name='$RuleName']/match" -Name url -Value $RulePattern
        Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter "$filter/rule[@name='$RuleName']/action" -Name type -Value Rewrite
        Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter "$filter/rule[@name='$RuleName']/action" -Name url -Value $RuleTarget
    }
}
else {
    Set-Service -Name $ServiceName -StartupType Manual
    if ($service.Status -eq 'Running') { Stop-Service -Name $ServiceName -Force }
    $rule = Get-RuleState
    if ($rule.Present) { Remove-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $SiteName -Filter 'system.webServer/rewrite/rules' -Name '.' -AtElement @{name=$RuleName} }
}
[IO.File]::WriteAllText((Join-Path $StateRoot 'deployment-schema-version.txt'), $SchemaVersion, (New-Object Text.UTF8Encoding($false)))
$after = Get-InfrastructureState
Write-StateSummary $after
if ($after.reconcile_required) { throw 'Production infrastructure is still inconsistent after reconcile.' }
[pscustomobject]$after | ConvertTo-Json -Compress
