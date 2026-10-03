import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const path = 'C:\\1212\\taba-device-test-runtime\\start-taba-device-test.ps1';

test('supervisor prompts once per key with SecureString and strict prefixes', async () => {
  const source = await readFile(path, 'utf8');
  assert.equal((source.match(/Read-Host 'Secret key activa/g) || []).length, 1);
  assert.equal((source.match(/Read-Host 'Publishable key activa/g) || []).length, 1);
  assert.equal((source.match(/-AsSecureString/g) || []).length, 2);
  assert.match(source, /\^sb_secret_/);
  assert.match(source, /\^sb_publishable_/);
  assert.doesNotMatch(source, /Write-Host\s+\$(?:secret|publishable)/i);
});

test('supervisor pins worktree, commit, project, port, and thirteen migrations', async () => {
  const source = await readFile(path, 'utf8');
  assert.match(source, /C:\\1212\\la-taba-s23-iphone-test/);
  assert.match(source, /cb49a32483475492efc80602b5914e2fbc76737e/);
  assert.match(source, /yakhtrkukqlgzvxuvhzs/);
  assert.match(source, /\$Port = 4173/);
  assert.match(source, /Count -ne 13/);
});

test('supervisor leaves successful server and tunnel alive and emits exact readiness marker', async () => {
  const source = await readFile(path, 'utf8');
  assert.match(source, /\$ServerScriptPath = .*secure-frontend-server\.mjs/);
  assert.match(source, /Start-Process -FilePath 'node\.exe'/);
  assert.match(source, /cloudflared\.exe/);
  assert.match(source, /\$script:Completed = \$true/);
  assert.match(source, /TABA_DEVICE_TEST_READY/);
  assert.match(source, /#business/);
  assert.match(source, /#rider/);
  assert.match(source, /Write-TestEvent 'public_smoke' 'OK'/);
});

test('supervisor never modifies Git or deployment state', async () => {
  const source = await readFile(path, 'utf8');
  assert.doesNotMatch(source, /git\s+(?:add|commit|push|reset|clean|stash|restore|checkout)/i);
  assert.doesNotMatch(source, /supabase\s+(?:db\s+push|migration\s+up|functions\s+deploy)/i);
});
