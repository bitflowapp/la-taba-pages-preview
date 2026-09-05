import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configureWebhookSecret } from '../scripts/mercadopago/configurar-webhook-staging.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fixture = 'fixture_webhook_signature_only';
const configured = () => [
  ...['MERCADOPAGO_CLIENT_ID', 'MERCADOPAGO_CLIENT_SECRET', 'MERCADOPAGO_TOKEN_ENCRYPTION_KEY'].map(name => ({name, value: 'existing-hash'})),
  ...Object.entries({TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_PROJECT_REF: 'ukxqbgswjlibmnjemrzd'})
    .map(([name, value]) => ({name, value: hash(value)})),
];
test('webhook setup writes only its secret and verifies the saved hash', async () => {
  const calls = [];
  await configureWebhookSecret(fixture, {
    withToken: task => task('fixture-management-auth'),
    request: async (url, options) => {
      calls.push({url, options});
      return Response.json(calls.length === 3 ? [...configured(), {name: 'MERCADOPAGO_OAUTH_WEBHOOK_SECRET', value: hash(fixture)}] : configured());
    },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url === 'https://api.supabase.com/v1/projects/ukxqbgswjlibmnjemrzd/secrets'));
  assert.deepEqual(JSON.parse(calls[1].options.body), [{name: 'MERCADOPAGO_OAUTH_WEBHOOK_SECRET', value: fixture}]);
});
test('webhook setup refuses a production environment before writing', async () => {
  let calls = 0;
  await assert.rejects(configureWebhookSecret(fixture, {
    withToken: task => task('fixture-management-auth'),
    request: async () => {
      calls++;
      return Response.json(configured().map(item => item.name === 'MERCADOPAGO_ENVIRONMENT' ? {...item, value: hash('production')} : item));
    },
  }), /No se modifico nada/);
  assert.equal(calls, 1);
});
test('webhook setup refuses a truncated signature before obtaining management credentials', async () => {
  await assert.rejects(configureWebhookSecret('abc1234...', {
    withToken: () => assert.fail('must not read credentials'),
  }), /No se modifico staging/);
});

test('webhook setup fails explicitly when Supabase rejects the write', async () => {
  await assert.rejects(configureWebhookSecret(fixture, {
    withToken: task => task('fixture-management-auth'),
    request: async (_url, options) => options.method === 'POST'
      ? new Response(null, {status: 403}) : Response.json(configured()),
  }), /No se pudo guardar/);
});
test('webhook setup cannot report success if the saved hash differs', async () => {
  await assert.rejects(configureWebhookSecret(fixture, {
    withToken: task => task('fixture-management-auth'),
    request: async () => Response.json(configured()),
  }), /no se pudo verificar/);
});

test('PowerShell surfaces CONFIGURED and rejects a failed child without exposing input', {skip: process.platform !== 'win32'}, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taba-webhook-prompt-'));
  const loader = path.join(directory, 'fixture-loader.mjs');
  const script = path.resolve('scripts/mercadopago/configurar-webhook-staging.ps1').replaceAll("'", "''");
  writeFileSync(loader, `
    import {createHash} from 'node:crypto';
    let saved;
    globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.supabase.com/v1/projects/ukxqbgswjlibmnjemrzd/secrets') throw Error('Unexpected endpoint');
      if (options.method === 'POST') {
        if (process.env.TABA_FIXTURE_REJECT === '1') return new Response(null,{status:403});
        saved = JSON.parse(options.body)[0].value;
        return Response.json([]);
      }
      return Response.json([...${JSON.stringify(configured())}, ...(saved ? [{name:'MERCADOPAGO_OAUTH_WEBHOOK_SECRET',value:createHash('sha256').update(saved).digest('hex')}] : [])]);
    };
  `);
  try {
    for (const reject of ['0', '1']) {
      const command = `$ErrorActionPreference='Stop'; function Read-Host { param($Prompt,[switch]$AsSecureString); $fixtureSecure=[System.Security.SecureString]::new(); foreach($fixtureChar in 'fixture_hidden_input_only'.ToCharArray()) { $fixtureSecure.AppendChar($fixtureChar) }; return $fixtureSecure }; & '${script}'`;
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8', timeout: 30000, windowsHide: true,
        env: {...process.env, SUPABASE_ACCESS_TOKEN:'fixture-management-auth', TABA_FIXTURE_REJECT:reject, NODE_OPTIONS:`--import=${pathToFileURL(loader).href}`},
      });
      assert.doesNotMatch(result.stdout + result.stderr, /fixture_hidden_input_only|fixture-management-auth/);
      if (reject === '0') {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), 'CONFIGURED');
      } else {
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.stdout, /CONFIGURED/);
        assert.match(result.stderr, /No se pudo confirmar/);
      }
    }
  } finally {
    unlinkSync(loader);
    rmdirSync(directory);
  }
});
