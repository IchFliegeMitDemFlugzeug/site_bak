$ErrorActionPreference = 'Stop'
Import-Module WebAdministration
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator' }
if (-not (Test-Path 'IIS:\Sites\BTS-STAGE')) { throw 'IIS site BTS-STAGE is missing' }
try { Get-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -ErrorAction Stop | Out-Null } catch { throw 'IIS Application Request Routing is required' }
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled -Value true
$filter = 'system.webServer/rewrite/rules'
$existing = Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location 'BTS-STAGE' -Filter "$filter/rule[@name='BTS API reverse proxy']" -Name '.' -ErrorAction SilentlyContinue
if (-not $existing) {
    & "$env:windir\system32\inetsrv\appcmd.exe" add backup "BTS-STAGE-before-api-$(Get-Date -Format 'yyyyMMdd-HHmmss')" | Out-Null
    Add-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location 'BTS-STAGE' -Filter $filter -Name '.' -Value @{name='BTS API reverse proxy';patternSyntax='ECMAScript';stopProcessing='True'}
    Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location 'BTS-STAGE' -Filter "$filter/rule[@name='BTS API reverse proxy']/match" -Name url -Value '^api/(.*)$'
    Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location 'BTS-STAGE' -Filter "$filter/rule[@name='BTS API reverse proxy']/action" -Name type -Value Rewrite
    Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location 'BTS-STAGE' -Filter "$filter/rule[@name='BTS API reverse proxy']/action" -Name url -Value 'http://127.0.0.1:3001/api/{R:1}'
}
Write-Host 'PASS: BTS-STAGE /api/* proxies to 127.0.0.1:3001.'
