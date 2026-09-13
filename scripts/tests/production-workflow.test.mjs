import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const release = read('scripts/release-prod.ps1');
const ensure = read('scripts/production/ensure-production.ps1');
const worker = read('scripts/production/worker-v2.ps1');

test('dry run exits before every production upload and reconcile call', () => {
  const guard = release.indexOf("if($dryrun){Write-Host 'PASS: dry run is read-only");
  assert.ok(guard > 0, 'the explicit read-only dry-run guard must exist');
  assert.ok(guard < release.indexOf('$winSW=Get-WinSW'));
  assert.ok(guard < release.indexOf('Copy-ToProduction $ensureSource'));
  assert.ok(guard < release.indexOf('Invoke-Ensure $remoteInfra'));
});

test('ensure validates prerequisites before its first infrastructure mutation', () => {
  const prerequisiteFailure = ensure.indexOf("throw \"Base prerequisites are missing:");
  const firstDirectoryWrite = ensure.indexOf('foreach ($path in $RequiredDirectories) { New-Item');
  assert.ok(prerequisiteFailure > 0 && prerequisiteFailure < firstDirectoryWrite);
  assert.match(ensure, /if \(\$CheckOnly\)[\s\S]*?return[\s\S]*?Test-Administrator/);
});

test('public proxy is enabled only after strict local backend health', () => {
  const health = ensure.indexOf("if (-not (Test-BackendHealth)) { throw");
  const publicRule = ensure.indexOf("Add-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST'");
  assert.ok(health > 0 && health < publicRule);
  // Enabling the ARR engine itself is safe; without the site rule it exposes no endpoint.
  assert.ok(ensure.indexOf("-Filter 'system.webServer/proxy' -Name enabled") < health);
  assert.match(ensure, /Content\.Trim\(\) -ceq '\{"ok":true\}'/);
});

test('release reconciles before deploy, after deploy, and after external rollback', () => {
  const calls = [...release.matchAll(/Invoke-Ensure \$remoteInfra/g)].map(({ index }) => index);
  const requestUpload = release.indexOf('Copy-ToProduction $request');
  const externalChecks = release.indexOf('Test-ExternalProduction $urls');
  assert.equal(calls.length, 3);
  assert.ok(calls[0] < requestUpload && calls[1] > requestUpload && calls[1] < externalChecks);
  assert.ok(calls[2] > externalChecks);
});

test('first-backend rollback removes a failed junction when no predecessor exists', () => {
  assert.match(worker, /elseif \(\$BackendChanged\)[\s\S]*?Stop-Service[\s\S]*?rmdir/);
  assert.match(worker, /Restore-Snapshot \$snapshot \$frontendChanged \$backendChanged/);
});

test('legacy manual migration scripts and secret output are absent', () => {
  assert.equal(fs.existsSync(new URL('../production/migrate-two-component.ps1', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../production/rollback-migration.ps1', import.meta.url)), false);
  assert.doesNotMatch(ensure, /Write-(Host|Output).*SMTP_PASS/i);
});
