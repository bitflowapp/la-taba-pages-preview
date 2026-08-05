import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = new URL('../supabase/migrations/20260805120000_fiscal_homologation_authorization_split.sql', import.meta.url);
const sql = fs.readFileSync(file, 'utf8');

const panel = fs.readFileSync(
  new URL('../supabase/migrations/20260804090000_business_operations_panel.sql', import.meta.url),
  'utf8',
);
const closure = fs.readFileSync(
  new URL('../supabase/migrations/20260802170000_fiscal_document_closure.sql', import.meta.url),
  'utf8',
);

// Lo que la base ejecuta, sin los comentarios que explican por qué.
const stripComments = (value) => value.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ');
const code = stripComments(sql);

test('la migración es incremental, posterior y no destruye datos', () => {
  assert.match(file.pathname, /20260805120000_fiscal_homologation_authorization_split[.]sql$/);
  assert.doesNotMatch(code, /drop table|truncate table|delete from/i);
});

test('la base admite un perfil configurado para homologación sin autorizar', () => {
  // El gate anterior exigía autorización para poder siquiera guardar el entorno de homologación.
  assert.match(sql, /drop constraint if exists fiscal_profiles_homologation_gate/i);
  assert.match(
    sql,
    /add constraint fiscal_profiles_homologation_authorization_pairing check \([\s\S]*homologation_authorized_at is null and homologation_authorized_by is null/i,
  );
});

test('la autorización viaja completa o no viaja', () => {
  assert.match(
    sql,
    /homologation_authorized_at is not null and homologation_authorized_by is not null/i,
  );
});

test('el constraint se valida de verdad: nada de NOT VALID para esconder el problema', () => {
  assert.doesNotMatch(code, /not\s+valid/i);
});

test('la migración corre sobre datos existentes sin inventar autorizaciones', () => {
  // Una autorización a medias se descarta; jamás se completa con una fecha o un actor inventados.
  const saneo = sql.indexOf('update public.fiscal_profiles');
  const constraint = sql.indexOf('add constraint fiscal_profiles_homologation_authorization_pairing');
  assert.ok(saneo > -1, 'debería sanear los pares incompletos');
  assert.ok(constraint > -1, 'debería endurecer el par');
  assert.ok(saneo < constraint, 'el saneo tiene que ocurrir antes de endurecer el par');
  assert.match(code, /set\s+homologation_authorized_at = null,\s*\n\s*homologation_authorized_by = null/i);
  assert.doesNotMatch(code, /homologation_authorized_at\s*=\s*(?:now|clock_timestamp)\s*\(/i);
  assert.doesNotMatch(code, /homologation_authorized_by\s*=\s*'[0-9a-f-]{36}'/i);
});

test('emitir un comprobante exige la autorización humana registrada', () => {
  assert.match(sql, /create trigger fiscal_documents_require_execution_authorization\s*\n\s*before insert on public[.]fiscal_documents/i);
  assert.match(sql, /new[.]environment = 'homologation'[\s\S]{0,160}homologation_authorized_at is null or v_profile[.]homologation_authorized_by is null/i);
  assert.match(sql, /raise exception 'homologacion no autorizada' using errcode = '42501'/i);
});

test('la operación falla cerrada sin perfil fiscal', () => {
  assert.match(sql, /if not found then\s*\n\s*raise exception 'operacion fiscal no autorizada'/i);
});

test('la producción sigue exigiendo contador y gate de producción', () => {
  assert.match(sql, /new[.]environment = 'production'[\s\S]{0,220}production_gate_status is distinct from 'approved'/i);
  assert.match(sql, /raise exception 'produccion fiscal no autorizada' using errcode = '42501'/i);
  // El guard compara contra producción, pero la migración nunca la enciende.
  assert.doesNotMatch(code, /set\s+environment\s*=\s*'production'/i);
  assert.doesNotMatch(code, /set\s+production_gate_status\s*=\s*'approved'/i);
  assert.doesNotMatch(code, /set\s+accountant_review_status\s*=\s*'approved'/i);
});

test('los errores del guard son estables y no exponen constraints ni SQL', () => {
  for (const match of sql.matchAll(/raise exception '([^']+)'/g)) {
    assert.doesNotMatch(match[1], /constraint|relation|column|select|insert|update |pg_|violates/i,
      `el mensaje "${match[1]}" no debería delatar la estructura de la base`);
  }
});

test('el guard es SECURITY DEFINER con search_path fijo', () => {
  assert.match(sql, /create or replace function public[.]assert_fiscal_execution_authorized\(\)[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog, public, pg_temp/i);
});

test('configurar un perfil nunca escribe las columnas de autorización', () => {
  // configure_fiscal_profile guarda configuración; autorizar es otra operación, con otra frase.
  const fn = closure.slice(
    closure.indexOf('function public.configure_fiscal_profile'),
    closure.indexOf('$configure_profile_closure$;'),
  );
  assert.ok(fn.length > 0, 'debería encontrar configure_fiscal_profile');
  assert.doesNotMatch(fn, /homologation_authorized_at|homologation_authorized_by/i);
  assert.match(fn, /not in \('disabled','homologation'\) then raise exception 'produccion no se configura desde el panel'/i);
});

test('autorizar sigue exigiendo la frase exacta y deja rastro real', () => {
  assert.match(panel, /p_authorization is distinct from 'I_AUTHORIZE_ARCA_HOMOLOGATION'/);
  assert.match(panel, /homologation_authorized_at = clock_timestamp\(\)/i);
  assert.match(panel, /homologation_authorized_by = auth[.]uid\(\)/i);
});
