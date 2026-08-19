/*
 * Quién puede operar el catálogo.
 *
 * Este archivo existe por un falso negativo real: el guion de asociación
 * comprobaba `has_business_role(..., ['owner'])` cuando las cinco RPC de
 * catálogo aceptan `['owner', 'admin']`. Un caso feliz que pasa no habría
 * detectado nada de eso, así que acá el caso feliz es una línea y el resto son
 * rechazos.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  autorizaCatalogo,
  ROLES_CATALOGO,
  ROLES_CONOCIDOS,
} from '../scripts/catalog-images/owner-authority.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('owner activo → PASA', () => {
  const { autorizado, rol } = autorizaCatalogo('owner');
  assert.equal(autorizado, true);
  assert.equal(rol, 'owner');
});

test('admin activo → PASA, y esto es lo que el guard viejo rechazaba', () => {
  const { autorizado, rol } = autorizaCatalogo('admin');
  assert.equal(autorizado, true, 'las RPC de catálogo aceptan admin además de owner');
  assert.equal(rol, 'admin');
});

test('CONTROL NEGATIVO: rider → FALLA', () => {
  const { autorizado, motivo } = autorizaCatalogo('rider');
  assert.equal(autorizado, false);
  assert.match(motivo, /el rol es rider/);
});

test('CONTROL NEGATIVO: staff → FALLA', () => {
  const { autorizado, motivo } = autorizaCatalogo('staff');
  assert.equal(autorizado, false, 'staff atiende pedidos, no publica catálogo');
  assert.match(motivo, /el rol es staff/);
});

/*
 * Los cuatro casos que siguen son, del lado de la base, EL MISMO caso: cliente
 * sin membresía, membresía inactiva, membresía de otro negocio y sesión sin
 * registrar hacen que `identity_member_role` devuelva null. No se distinguen a
 * propósito —quien pregunta desde afuera no tiene por qué enterarse de cuál
 * fue—, y por eso se prueban los cuatro contra la misma entrada: lo que se
 * comprueba es que ninguno se cuele.
 */
for (const caso of [
  'cliente sin membership',
  'membership inactiva (is_active = false)',
  'membership de otro business',
  'sesión no registrada en identity_sessions',
]) {
  test(`CONTROL NEGATIVO: ${caso} → FALLA`, () => {
    const { autorizado, rol, motivo } = autorizaCatalogo(null);
    assert.equal(autorizado, false);
    assert.equal(rol, null);
    assert.match(motivo, /no reconoce ningún rol/);
  });
}

test('CONTROL NEGATIVO: cadena vacía y espacios → FALLA', () => {
  for (const entrada of ['', '   ', undefined, 0, false]) {
    assert.equal(autorizaCatalogo(entrada).autorizado, false, `«${String(entrada)}» no autoriza`);
  }
});

test('CONTROL NEGATIVO: un rol que no existe → FALLA y lo dice', () => {
  const { autorizado, motivo } = autorizaCatalogo('superadmin');
  assert.equal(autorizado, false, 'no se asume nada sobre un rol desconocido');
  assert.match(motivo, /no conoce/);
});

test('el motivo de un rechazo por falta de rol nombra la causa que más sorprende', () => {
  // La sesión sin registrar es la que agarra a cualquier herramienta que entra
  // por la API: si el mensaje no la nombra, el próximo va a buscar el problema
  // en la membresía, que es donde no está.
  assert.match(autorizaCatalogo(null).motivo, /NUNCA SE REGISTRÓ con identity_register_session/);
});

/*
 * El contrato no se copia de memoria: se lee del SQL. Si mañana alguien cambia
 * los roles que exigen las RPC, este test se pone rojo antes de que el guion
 * empiece a rechazar gente que la base acepta —que es exactamente lo que pasó.
 */
test('ROLES_CATALOGO es lo que las RPC de catálogo exigen, leído del SQL', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20260725110000_catalog_publication_authority.sql'),
    'utf8',
  );
  const exigencias = [...sql.matchAll(/has_business_role\(\s*p_business_id\s*,\s*array\[([^\]]+)\]/g)]
    .map((coincidencia) => coincidencia[1]
      .split(',')
      .map((rol) => rol.trim().replace(/^'|'$/g, ''))
      .sort()
      .join(','));

  assert.ok(exigencias.length >= 5, `se esperaban al menos 5 RPC guardadas y hay ${exigencias.length}`);
  const distintas = new Set(exigencias);
  assert.equal(distintas.size, 1, `las RPC no piden todas lo mismo: ${[...distintas].join(' | ')}`);
  assert.equal([...distintas][0], [...ROLES_CATALOGO].sort().join(','));
});

test('el Panel privilegiado usa la misma pareja de roles', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'js/production-operations.js'), 'utf8');
  assert.ok(
    panel.includes("['owner', 'admin']"),
    'si el Panel cambiara de criterio, el guion tiene que enterarse',
  );
});

test('ROLES_CATALOGO es un subconjunto de los roles que la base admite', () => {
  for (const rol of ROLES_CATALOGO) {
    assert.ok(ROLES_CONOCIDOS.includes(rol), `${rol} no es un rol válido de business_members`);
  }
  const sql = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20260812010000_identity_core_model.sql'),
    'utf8',
  );
  assert.match(sql, /check \(role in \('owner', 'admin', 'staff', 'rider'\)\)/);
});
