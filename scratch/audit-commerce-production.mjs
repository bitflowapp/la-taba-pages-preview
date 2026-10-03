import pg from 'pg';
import { execSync } from 'child_process';

const { Client } = pg;

function getProductionPassword() {
  const cmd = `powershell -NoProfile -Command "$sec = Get-Content 'C:\\Users\\marco\\.taba-secrets\\taba2-production-supabase-db-password.dpapi' | ConvertTo-SecureString; [System.Net.NetworkCredential]::new('', $sec).Password"`;
  return execSync(cmd, { encoding: 'utf-8' }).trim();
}

async function runAudit() {
  const dbPassword = getProductionPassword();
  const connectionString = `postgresql://postgres.wwcpogltfgzgkrlilbcd:${encodeURIComponent(dbPassword)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('--- BUSINESS STATUS ---');
  const bizRes = await client.query(`
    select 
      id, name, address, status, is_active, ordering_enabled, ordering_verified,
      delivery_enabled, pickup_enabled, delivery_fee, minimum_delivery_subtotal,
      delivery_zone_enforced, hours_enforced, alcohol_hours_enforced,
      operating_timezone, delivery_max_radius_meters
    from public.businesses
    where id = '00000000-0000-4000-8000-000000000001';
  `);
  console.log(JSON.stringify(bizRes.rows[0], null, 2));

  console.log('--- COUNTS OF HOURS & ZONES ---');
  const hoursRes = await client.query(`select count(*)::int as count from public.business_service_hours where business_id = '00000000-0000-4000-8000-000000000001';`);
  const zonesRes = await client.query(`select count(*)::int as count from public.delivery_zones where business_id = '00000000-0000-4000-8000-000000000001';`);
  console.log(`Service hours rows: ${hoursRes.rows[0].count}`);
  console.log(`Delivery zones rows: ${zonesRes.rows[0].count}`);

  console.log('--- PRODUCTS METRICS ---');
  const prodRes = await client.query(`
    select 
      count(*)::int as total_products,
      count(*) filter (where is_active)::int as active_products,
      count(*) filter (where is_verified)::int as verified_products,
      count(*) filter (where available)::int as available_products,
      count(*) filter (where merchant_available)::int as merchant_available_products,
      count(*) filter (where price_status = 'confirmed')::int as confirmed_prices,
      count(*) filter (where price is not null and price > 0)::int as priced_products,
      count(*) filter (where stock > 0)::int as in_stock_products,
      count(*) filter (where is_active and is_verified and available and price_status = 'confirmed' and price > 0 and stock > 0)::int as sellable_products
    from public.products
    where business_id = '00000000-0000-4000-8000-000000000001';
  `);
  console.log(JSON.stringify(prodRes.rows[0], null, 2));

  console.log('--- PAYMENT SETTINGS ---');
  const payRes = await client.query(`
    select * from public.business_payment_settings
    where business_id = '00000000-0000-4000-8000-000000000001';
  `);
  console.log(`Payment settings rows: ${payRes.rows.length}`);
  if (payRes.rows.length > 0) {
    console.log(JSON.stringify(payRes.rows, null, 2));
  }

  console.log('--- COMMERCE AVAILABILITY RPC ---');
  const availRes = await client.query(`
    select public.commerce_availability('00000000-0000-4000-8000-000000000001', 'delivery', '{}'::jsonb) as avail;
  `);
  console.log(JSON.stringify(availRes.rows[0].avail, null, 2));

  await client.end();
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
