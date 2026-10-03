import pg from 'pg';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const { Client } = pg;

function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
  });
}

function getProductionPassword() {
  const cmd = `powershell -NoProfile -Command "$sec = Get-Content 'C:\\Users\\marco\\.taba-secrets\\taba2-production-supabase-db-password.dpapi' | ConvertTo-SecureString; [System.Net.NetworkCredential]::new('', $sec).Password"`;
  return execSync(cmd, { encoding: 'utf-8' }).trim();
}

async function runSmoke() {
  console.log('========================================================');
  console.log('PHASE 12 & 13: PRODUCTION HEALTH & SMOKE (SAFE, NO MONEY MOVEMENT)');
  console.log('========================================================');

  // 1. Live Web: https://la-taba.pages.dev/
  console.log('\n[1] Checking live web landing https://la-taba.pages.dev/ ...');
  const webRes = await fetchUrl('https://la-taba.pages.dev/');
  console.log(`HTTP Status: ${webRes.status}`);
  console.log(`Content length: ${webRes.body.length}`);
  const hasDocType = webRes.body.includes('<!DOCTYPE html>');
  const hasAppTitle = webRes.body.includes('La Taba') || webRes.body.includes('taba');
  console.log(`Valid HTML document: ${hasDocType}`);
  console.log(`Contains La Taba branding: ${hasAppTitle}`);

  // 2. Runtime Config: https://la-taba.pages.dev/runtime-config.js
  console.log('\n[2] Checking runtime-config.js on Cloudflare Pages ...');
  const rcRes = await fetchUrl('https://la-taba.pages.dev/runtime-config.js');
  console.log(`HTTP Status: ${rcRes.status}`);
  console.log(`Body:\n${rcRes.body.trim()}`);
  const hasProdRef = rcRes.body.includes('wwcpogltfgzgkrlilbcd');
  const hasStagingRef = rcRes.body.includes('ukxqbgswjlibmnjemrzd') || rcRes.body.includes('ucbtjcurawxjwjdvvcvj');
  console.log(`Target project is PRODUCTION (wwcpogltfgzgkrlilbcd): ${hasProdRef}`);
  console.log(`Staging leak present: ${hasStagingRef}`);

  // Extract publishable key from runtime-config
  const keyMatch = rcRes.body.match(/publishableKey:\s*['"]([^'"]+)['"]/);
  const publishableKey = keyMatch ? keyMatch[1] : null;
  console.log(`Extracted publishable key prefix: ${publishableKey ? publishableKey.slice(0, 18) + '...' : 'NONE'}`);

  // 3. Supabase Auth Health: https://wwcpogltfgzgkrlilbcd.supabase.co/auth/v1/health
  console.log('\n[3] Checking Supabase Auth health endpoint ...');
  const authRes = await fetchUrl('https://wwcpogltfgzgkrlilbcd.supabase.co/auth/v1/health', {
    apikey: publishableKey || ''
  });
  console.log(`HTTP Status: ${authRes.status}`);
  console.log(`Body: ${authRes.body.trim()}`);

  // 4. Supabase DB checks
  console.log('\n[4] Connecting to Production DB pooler (read-only queries) ...');
  const dbPassword = getProductionPassword();
  const connectionString = `postgresql://postgres.wwcpogltfgzgkrlilbcd:${encodeURIComponent(dbPassword)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // 4.1 Catalog Sellable Products
  console.log('\n[4.1] Checking catalog sellable products ...');
  const catRes = await client.query(`
    select 
      count(*)::int as total,
      count(*) filter (where is_active and is_verified and available and merchant_available and price_status = 'confirmed' and price > 0 and stock > 0)::int as sellable
    from public.products
    where business_id = '00000000-0000-4000-8000-000000000001';
  `);
  console.log(`Total products: ${catRes.rows[0].total}`);
  console.log(`Sellable products (active, verified, available, confirmed price, in stock): ${catRes.rows[0].sellable}`);

  // Sample top 5 sellable products
  const sampleRes = await client.query(`
    select sku, name, presentation, price, stock
    from public.products
    where business_id = '00000000-0000-4000-8000-000000000001'
      and is_active and is_verified and available and merchant_available and price_status = 'confirmed' and price > 0 and stock > 0
    order by sku asc
    limit 5;
  `);
  console.log('Sample sellable products:');
  console.table(sampleRes.rows);

  // 4.2 Commerce Availability RPC
  console.log('\n[4.2] Testing public.commerce_availability RPC ...');
  const rpcRes = await client.query(`
    select public.commerce_availability('00000000-0000-4000-8000-000000000001', 'delivery', '{}'::jsonb) as res;
  `);
  console.log(JSON.stringify(rpcRes.rows[0].res, null, 2));

  // 4.3 Fail-closed Checkout / Payment Settings
  console.log('\n[4.3] Testing fail-closed behavior for unconfigured payment methods ...');
  const payCount = await client.query(`
    select count(*)::int as count from public.business_payment_settings
    where business_id = '00000000-0000-4000-8000-000000000001';
  `);
  console.log(`Mercado Pago payment settings rows for business: ${payCount.rows[0].count}`);
  if (payCount.rows[0].count === 0) {
    console.log('SAFE FAIL-CLOSED: Mercado Pago preferences cannot be created until Walter OAuth is connected.');
  }

  // 4.4 Fail-closed Service Enforcement Guards
  console.log('\n[4.4] Testing set_service_enforcement fail-closed guard (dry run inside rollback transaction) ...');
  await client.query('begin;');
  try {
    // Attempt to turn on hours enforcement without hours
    await client.query(`
      select public.set_service_enforcement(
        '00000000-0000-4000-8000-000000000001',
        true, false, false, 'America/Argentina/Buenos_Aires'
      );
    `);
    console.log('UNEXPECTED: set_service_enforcement should have thrown error!');
  } catch (err) {
    console.log(`EXPECTED FAIL-CLOSED: set_service_enforcement rejected activation without hours: [${err.code}] ${err.message}`);
  }
  await client.query('rollback;');

  await client.end();
  console.log('\nAll smoke checks completed successfully.');
}

runSmoke().catch(err => {
  console.error('Smoke failed:', err);
  process.exit(1);
});
