import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const release = read('scripts/release-prod.ps1');
const ensure = read('scripts/production/ensure-production.ps1');
const worker = read('scripts/production/worker-v2.ps1');
const bootstrap = read('scripts/production/bootstrap-worker-v2.ps1');
const serviceXml = read('backend/config/BTS.ContactApi.xml');

test('release never invokes ensure directly over SSH', () => {
  assert.doesNotMatch(release, /powershell\.exe[^\n]+ensure-production\.ps1/i);
  assert.doesNotMatch(release, /function Get-ProductionState/);
  assert.match(release, /Invoke-ReconcileRequest -Mode check/);
  assert.match(worker, /& \$EnsureTarget -CheckOnly -WorkerSource \$PSCommandPath/);
});

test('dry run reaches only the check request and exits before apply assets', () => {
  const check = release.indexOf('Invoke-ReconcileRequest -Mode check');
  const guard = release.indexOf('if ($dryrun)');
  const apply = release.indexOf('Invoke-ReconcileRequest -Mode apply');
  assert.ok(check > 0 && check < guard && guard < apply);
  assert.ok(guard < release.indexOf('$winSW = Get-WinSW'));
});

test('SYSTEM worker owns both check-only and apply reconcile execution', () => {
  assert.match(worker, /Process-Reconcile/);
  assert.match(worker, /identity\.User\.Value -ne 'S-1-5-18'/);
  assert.match(worker, /'checked' 'production infrastructure checked without changes'/);
  assert.match(worker, /'reconciled' 'production infrastructure reconciled by SYSTEM worker'/);
  assert.match(worker, /Get-ChildItem \$Incoming -Filter '\*\.reconcile\.json'/);
});

test('bootstrap only installs the worker broker and canonical ensure', () => {
  assert.match(bootstrap, /Run this one-time worker bootstrap as Administrator/);
  assert.match(bootstrap, /Copy-Item -LiteralPath \$WorkerSource/);
  assert.match(bootstrap, /Copy-Item -LiteralPath \$EnsureSource/);
  assert.doesNotMatch(bootstrap, /BTSContactApi|backend-current|Set-WebConfiguration|npm/);
});

test('ensure validates prerequisites and SMTP port before mutations', () => {
  const failure = ensure.indexOf('Base prerequisites are missing:');
  const mutation = ensure.indexOf('foreach ($path in $RequiredDirectories) { New-Item');
  assert.ok(failure > 0 && failure < mutation);
  assert.match(ensure, /\[int\]::TryParse\(\$smtpPortText/);
  assert.match(ensure, /\$smtpPort -ge 1 -and \$smtpPort -le 65535/);
});

test('scheduled task validation covers identity, elevation, enabled state and recurrence', () => {
  assert.match(ensure, /NT AUTHORITY\\\\SYSTEM/);
  assert.match(ensure, /RunLevel -eq 'Highest'/);
  assert.match(ensure, /\$task\.State -ne 'Disabled'/);
  assert.match(ensure, /Test-RecurringTrigger \$taskXml/);
});

test('contact API runs as LocalService with narrowly scoped ACLs', () => {
  assert.match(serviceXml, /<user>LocalService<\/user>/);
  assert.match(ensure, /StartName -eq 'NT AUTHORITY\\LocalService'/);
  assert.match(ensure, /BackendReleases -Permission 'RX'/);
  assert.match(ensure, /ServiceRoot 'logs'\) -Permission 'M'/);
  assert.doesNotMatch(serviceXml, /LocalSystem/);
});

test('public API rule follows strict local health', () => {
  const health = ensure.indexOf("if (-not (Test-BackendHealth)) { throw");
  const rule = ensure.indexOf("Add-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST'");
  assert.ok(health > 0 && health < rule);
  assert.match(ensure, /Content\.Trim\(\) -ceq '\{"ok":true\}'/);
});

test('external checks retry three times with five-second pauses before rollback', () => {
  const loop = release.indexOf('for ($attempt = 1; $attempt -le 3; $attempt++)');
  const pause = release.indexOf('Start-Sleep -Seconds 5', loop);
  const rollback = release.indexOf("$rollbackPath = Join-Path", loop);
  assert.ok(loop > 0 && pause > loop && rollback > pause);
  assert.match(release, /if \(\$attempt -lt 3\)/);
});

test('first-backend rollback removes a failed junction without reverting infrastructure', () => {
  assert.match(worker, /elseif \(\$BackendChanged\)[\s\S]*?Stop-Service[\s\S]*?rmdir/);
  assert.doesNotMatch(worker, /rollback[\s\S]*ensure-production\.ps1/i);
});
