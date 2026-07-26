import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../supabase/migrations/20260725120000_business_contact_authority.sql', import.meta.url),
  'utf8',
);

test('business contact authority is ordered after catalog publication hardening', () => {
  assert.match(sql, /apply after 20260725110000_catalog_publication_authority\.sql/i);
  assert.match(sql, /add column if not exists whatsapp_verified boolean not null default false/i);
  assert.match(sql, /whatsapp_verified_at timestamptz/i);
  assert.match(sql, /whatsapp_verified_by uuid[\s\S]*references auth\.users/i);
});

test('phone changes fail closed and verified metadata is complete', () => {
  assert.match(
    sql,
    /businesses_whatsapp_verification_complete[\s\S]*not whatsapp_verified[\s\S]*whatsapp_verified_at is null[\s\S]*whatsapp_verified_by is null/i,
  );
  assert.match(sql, /whatsapp_verified[\s\S]*between 8 and 15/i);
  assert.match(
    sql,
    /businesses_fail_close_whatsapp_change[\s\S]*before insert or update of whatsapp_phone, whatsapp_verified_by/i,
  );
  assert.match(sql, /new\.whatsapp_verified := false/i);
  assert.match(
    sql,
    /old\.whatsapp_verified_by is not null[\s\S]*new\.whatsapp_verified_by is null/i,
  );
});

test('only an active owner or admin can stamp the public WhatsApp channel', () => {
  assert.match(sql, /set_business_whatsapp_contact\([\s\S]*security definer/i);
  assert.match(
    sql,
    /auth\.uid\(\) is null[\s\S]*has_business_role\(p_business_id, array\['owner', 'admin'\]\)/i,
  );
  assert.match(sql, /whatsapp_verified_by = auth\.uid\(\)/i);
  assert.match(sql, /whatsapp_verified_at = statement_timestamp\(\)/i);
  assert.match(
    sql,
    /grant execute on function public\.set_business_whatsapp_contact\(uuid, text, boolean\)[\s\S]*to authenticated/i,
  );
  const setContactGrantees = sql.match(
    /grant execute on function public\.set_business_whatsapp_contact\(uuid, text, boolean\)\s*to ([^;]+);/i,
  )?.[1] || '';
  assert.equal(setContactGrantees.trim().toLowerCase(), 'authenticated');
});

test('browser grants cannot self-verify or read raw contact authority', () => {
  assert.match(
    sql,
    /revoke select, update on table public\.businesses from anon, authenticated/i,
  );
  const selectColumns = sql.match(
    /grant select \(([\s\S]*?)\) on public\.businesses to anon, authenticated/i,
  )?.[1] || '';
  assert.doesNotMatch(
    selectColumns,
    /whatsapp_phone|whatsapp_verified|whatsapp_verified_by|ordering_verified_by/i,
  );

  const updateColumns = sql.match(
    /grant update \(([\s\S]*?)\) on public\.businesses to authenticated/i,
  )?.[1] || '';
  assert.doesNotMatch(updateColumns, /whatsapp_phone|whatsapp_verified|ordering_verified/i);
});

test('public contact RPC returns a normalized number only with a complete authority stamp', () => {
  assert.match(
    sql,
    /get_public_business_contact\([\s\S]*security definer[\s\S]*whatsapp_verified = true[\s\S]*whatsapp_verified_at is not null[\s\S]*whatsapp_verified_by is not null/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.get_public_business_contact\(uuid\)[\s\S]*to anon, authenticated/i,
  );
  assert.match(
    sql,
    /regexp_replace\(b\.whatsapp_phone, '\[\^0-9\]', '', 'g'\)/i,
  );
});
