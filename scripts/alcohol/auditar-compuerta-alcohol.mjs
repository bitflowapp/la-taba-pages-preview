/*
 * LA COMPUERTA DE ALCOHOL, LEÍDA DE LA BASE Y CONTRASTADA CONTRA EL CONTRATO.
 *
 * POR QUÉ EXISTE
 * --------------
 * Porque «se activa con un flag» es falso y ya costó explicarlo dos veces.
 * `create_order` exige CINCO campos del comercio juntos —habilitación, edad
 * mínima, inicio, fin y huso— y aborta con «politica de alcohol no configurada»
 * si falta cualquiera. Poner `alcohol_sales_enabled = true` con los otros
 * cuatro en NULL no habilita nada: deja la venta rota de otra manera.
 *
 * Y hay un detalle del esquema que cambia el plan de trabajo, medido y no
 * supuesto. El CHECK dice:
 *
 *     not alcohol_sales_enabled or (edad between 18 and 99 and inicio is not
 *     null and fin is not null and huso is not null and btrim(huso) <> '')
 *
 * O sea que los cuatro campos de política SE PUEDEN dejar cargados con la venta
 * apagada. Eso permite separar en dos lo que hoy es un solo salto: la
 * configuración —que es dato ya declarado por el titular y se puede dejar
 * puesta y auditada— y la HABILITACIÓN, que es una decisión con consecuencias
 * legales y no la toma un guion.
 *
 * QUÉ HACE Y QUÉ NO HACE
 * ----------------------
 *   · Audita: lee los cinco campos y dice cuáles bloquean.
 *   · Con `--aplicar`: escribe SÓLO los cuatro de política, tomados de
 *     `data/alcohol-policy.json`, que es donde vive lo que el titular declaró.
 *   · NUNCA escribe `alcohol_sales_enabled = true`. No hay bandera para eso, ni
 *     debe haberla: la habilitación comercial del local para expendio de
 *     bebidas alcohólicas es un hecho del mundo que este proceso no puede
 *     acreditar. Si alguna vez hay que encenderla, se enciende a mano, con
 *     alguien mirando y con la habilitación en la mano.
 *
 * LA POLÍTICA DE ALCOHOL NO SE PUEDE LEER, Y ESO ES UN HALLAZGO
 * ------------------------------------------------------------
 * Medido el 2026-08-26 contra producción: los cinco campos están en el GRANT de
 * UPDATE de `businesses` y NO están en el de SELECT
 * (`20260725120000_business_contact_authority.sql`), y `get_business_operations_config`
 * —lo único que el Panel lee— devuelve `alcohol_hours_enforced` pero ninguno de
 * los cinco. O sea que hoy un owner puede ESCRIBIR su política de alcohol y no
 * tiene forma de VERLA. Un `select` desde la sesión del Panel responde
 * «permission denied for table businesses».
 *
 * Consecuencia práctica para este guion: la lectura va por la Management API,
 * que es privilegiada, y la ESCRITURA va por la sesión autenticada del admin.
 * No es simetría rota por comodidad: escribir con la clave privilegiada dejaría
 * el rastro como `actor_kind='service'` y `actor_id=null` —exactamente el
 * agujero que dejó el `delivery_fee = 0` que nadie pudo atribuir—. Escrito por
 * la sesión, `business_config_audit` guarda QUIÉN.
 *
 * El arreglo de fondo —exponer los cinco campos en `get_business_operations_config`—
 * va en la migración `20260826120000_alcohol_policy_readable.sql`.
 *
 * Sin `--aplicar` no escribe nada.
 *
 *   node scripts/alcohol/auditar-compuerta-alcohol.mjs
 *   node scripts/alcohol/auditar-compuerta-alcohol.mjs --aplicar
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { correoDelPanel, IDENTIDAD_PANEL } from '../e2e-production-sale/identidades.mjs';
import { leerSecreto, objetivoCompleto } from '../e2e-production-sale/secretos-windows.mjs';
import { conToken } from '../lib/supabase-cli-token.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const REF = 'wwcpogltfgzgkrlilbcd';
const BASE = `https://${REF}.supabase.co`;
const ORIGEN_PUBLICO = process.env.TABA_PUBLIC_ORIGIN || 'https://la-taba.pages.dev';
const aplicar = process.argv.includes('--aplicar');

/** Los cinco campos que `create_order` mira, en el orden en que los mira. */
const CAMPOS = Object.freeze([
  'alcohol_sales_enabled',
  'alcohol_minimum_age',
  'alcohol_sales_start',
  'alcohol_sales_end',
  'alcohol_timezone',
]);

/** Los cuatro que este guion puede escribir. El quinto no está, a propósito. */
const CAMPOS_DE_POLITICA = Object.freeze(CAMPOS.filter((c) => c !== 'alcohol_sales_enabled'));

const paso = (t) => console.log(`\n── ${t}`);
const ok = (t) => console.log(`  OK    ${t}`);
const mal = (t) => console.log(`  FALTA ${t}`);
const info = (t) => console.log(`        ${t}`);

function abortar(mensaje) {
  console.error(`\nABORTA: ${mensaje}`);
  process.exit(1);
}

/** `09:00` y `09:00:00` son la misma hora; la base devuelve la segunda forma. */
const mismaHora = (a, b) => String(a || '').slice(0, 5) === String(b || '').slice(0, 5);

// ── El contrato declarado ────────────────────────────────────────────────────
const contrato = JSON.parse(await fs.readFile(path.join(ROOT, 'data/alcohol-policy.json'), 'utf8'));
const declarada = contrato.politica;

paso('CONTRATO DECLARADO');
info(`${path.relative(ROOT, path.join(ROOT, 'data/alcohol-policy.json')).replaceAll('\\', '/')}`);
info(`declarado por ${contrato.declarada_por} el ${contrato.declarada_el} · estado: ${contrato.estado}`);
for (const campo of CAMPOS) info(`${campo} = ${JSON.stringify(declarada[campo])}`);
info(`bloqueante declarado: ${contrato.bloqueante}`);

// ── Destino ──────────────────────────────────────────────────────────────────
paso('DESTINO');
const respuestaConfig = await fetch(`${ORIGEN_PUBLICO}/runtime-config.js`, { signal: AbortSignal.timeout(30_000) });
if (!respuestaConfig.ok) abortar(`runtime-config.js respondió ${respuestaConfig.status}.`);
const textoConfig = await respuestaConfig.text();
const urlPublicada = textoConfig.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
const apikey = textoConfig.match(/publishableKey:\s*'([^']+)'/)?.[1];
const businessId = textoConfig.match(/businessId:\s*'([^']+)'/)?.[1];
if (!urlPublicada?.includes(REF)) abortar(`el sitio publicado no apunta a ${REF}.`);
if (!apikey || /^(eyJ|sb_secret_|service_role)/.test(apikey)) {
  abortar('la clave publicada por el sitio parece privilegiada. No se usa.');
}
if (!businessId) abortar('el sitio publicado no declara businessId.');
ok(`${BASE} · negocio ${businessId}`);

// ── Identidad ────────────────────────────────────────────────────────────────
paso('IDENTIDAD');
const correo = correoDelPanel();
const credencial = leerSecreto(IDENTIDAD_PANEL.credencial);
if (!credencial?.secreto) {
  abortar(`no hay contraseña guardada en ${objetivoCompleto(IDENTIDAD_PANEL.credencial)}.`);
}
if (credencial.usuario && credencial.usuario.toLowerCase() !== correo.toLowerCase()) {
  abortar(`la credencial guardada es de ${credencial.usuario} y el contrato dice ${correo}.`);
}
ok(`${correo} · credencial leída del Credential Manager`);

let token = null;
let salida = 0;
try {
  const login = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password: credencial.secreto }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!login.ok) abortar(`Auth respondió ${login.status}: ${await login.text()}`);
  token = (await login.json()).access_token;
  if (!token) abortar('Auth no devolvió access_token.');

  const cabeceras = { apikey, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const rpc = async (fn, args) => {
    const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: cabeceras, body: JSON.stringify(args || {}) });
    if (!r.ok) throw new Error(`${fn} respondió ${r.status}: ${await r.text()}`);
    return r.json();
  };

  /*
   * Sin `identity_register_session` la base no reconoce ningún rol, por más
   * admin que sea la cuenta. Es la trampa que agarra a toda herramienta que
   * entra por la API y no hace lo que hace el Panel al iniciar sesión.
   */
  const registro = await rpc('identity_register_session', {
    p_app_version: 'alcohol-gate-audit',
    p_business_id: businessId,
    p_client: 'unknown',
    p_device_key_hash: null,
    p_device_label: 'auditar-compuerta-alcohol',
  });
  if (registro?.ok !== true) abortar(`no se pudo registrar la sesión (${registro?.code || 'sin código'}).`);
  const rol = await rpc('identity_member_role', { target_business_id: businessId });
  if (!['owner', 'admin'].includes(String(rol || ''))) {
    abortar(`la base devolvió rol «${rol}» y esto pide owner o admin.`);
  }
  ok(`sesión registrada · rol ${rol}`);

  /*
   * La lectura NO puede ir por la sesión: los cinco campos no están en el grant
   * de SELECT. Se comprueba en vivo —no se supone— y después se lee por la vía
   * privilegiada. Si algún día el grant se amplía, este bloque lo dice solo.
   */
  const sondaSesion = await fetch(
    `${BASE}/rest/v1/businesses?id=eq.${businessId}&select=${CAMPOS.join(',')}`,
    { headers: cabeceras },
  );
  const legiblePorLaSesion = sondaSesion.ok;
  if (legiblePorLaSesion) {
    info('la sesión SÍ puede leer los cinco campos: el grant de SELECT se amplió desde el 2026-08-26.');
  } else {
    info(`la sesión no puede leerlos (${sondaSesion.status}); se lee por la Management API. Es el hallazgo, no un rodeo.`);
  }

  const leer = async () => {
    if (legiblePorLaSesion) {
      const r = await fetch(
        `${BASE}/rest/v1/businesses?id=eq.${businessId}&select=${CAMPOS.join(',')}`,
        { headers: cabeceras },
      );
      if (!r.ok) throw new Error(`lectura respondió ${r.status}: ${await r.text()}`);
      const filas = await r.json();
      if (!filas.length) throw new Error('el negocio no devolvió ninguna fila.');
      return filas[0];
    }
    return conToken(async (tokenManagement) => {
      const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenManagement}`,
          'Content-Type': 'application/json',
          'User-Agent': 'taba-alcohol-gate-audit/1.0',
        },
        body: JSON.stringify({
          query: `select ${CAMPOS.join(', ')} from public.businesses where id = '${businessId}';`,
        }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(`Management API respondió ${r.status}: ${t.slice(0, 600)}`);
      const filas = JSON.parse(t);
      if (!filas.length) throw new Error('el negocio no devolvió ninguna fila.');
      return filas[0];
    });
  };

  // ── Estado real ────────────────────────────────────────────────────────────
  paso('ESTADO EN PRODUCCIÓN');
  const antes = await leer();
  for (const campo of CAMPOS) {
    const valor = antes[campo];
    const vacio = valor === null || valor === undefined || String(valor).trim() === '';
    if (campo === 'alcohol_sales_enabled') {
      console.log(`  ${valor === true ? 'ON   ' : 'OFF  '} ${campo} = ${JSON.stringify(valor)}`);
    } else if (vacio) mal(`${campo} = null`);
    else ok(`${campo} = ${JSON.stringify(valor)}`);
  }

  const politicaCompleta = CAMPOS_DE_POLITICA.every((c) => {
    const v = antes[c];
    return v !== null && v !== undefined && String(v).trim() !== '';
  });

  // ── Diagnóstico ────────────────────────────────────────────────────────────
  paso('COMPUERTAS');
  const compuertas = [
    {
      id: 'POLITICA_CARGADA',
      abierta: politicaCompleta,
      que_es: 'los cuatro campos de política cargados en `businesses`',
      quien: 'este guion, con --aplicar, desde data/alcohol-policy.json',
    },
    {
      id: 'HABILITACION_COMERCIAL',
      abierta: antes.alcohol_sales_enabled === true,
      que_es: 'alcohol_sales_enabled = true',
      quien: 'UNA PERSONA, con la habilitación de expendio del local acreditada. Este guion no la escribe nunca.',
    },
    {
      id: 'DISPONIBILIDAD',
      abierta: false,
      que_es: 'los productos con alcohol con available = true',
      quien: 'la publicación de catálogo, DESPUÉS de la habilitación: publicarlos antes deja al cliente agregar al carrito algo que create_order va a rechazar',
    },
  ];
  for (const c of compuertas) {
    console.log(`  ${c.abierta ? 'ABIERTA ' : 'CERRADA '} ${c.id} · ${c.que_es}`);
    if (!c.abierta) info(`          la cierra: ${c.quien}`);
  }

  // ── Aplicación ─────────────────────────────────────────────────────────────
  if (!aplicar) {
    paso('SIN --aplicar · no se escribió nada');
    process.exit(politicaCompleta ? 0 : 2);
  }

  if (politicaCompleta) {
    const iguales = Number(antes.alcohol_minimum_age) === Number(declarada.alcohol_minimum_age)
      && mismaHora(antes.alcohol_sales_start, declarada.alcohol_sales_start)
      && mismaHora(antes.alcohol_sales_end, declarada.alcohol_sales_end)
      && String(antes.alcohol_timezone) === String(declarada.alcohol_timezone);
    if (iguales) {
      paso('NADA QUE APLICAR · producción ya coincide con el contrato declarado');
      process.exit(0);
    }
    abortar(
      'producción ya tiene una política cargada y NO es la del contrato.\n'
      + '        Pisarla sería cambiar una regla de venta que alguien puso a propósito.\n'
      + '        Resolver a mano cuál de las dos vale antes de volver a correr esto.',
    );
  }

  paso('APLICANDO LOS CUATRO CAMPOS DE POLÍTICA');
  info('alcohol_sales_enabled NO se toca: sigue en false.');
  const cuerpo = Object.fromEntries(CAMPOS_DE_POLITICA.map((c) => [c, declarada[c]]));
  /*
   * `return=minimal` no es una preferencia de estilo. Con `representation`,
   * PostgREST devuelve la fila escrita y para eso necesita SELECT sobre esas
   * columnas — que es justamente lo que la sesión NO tiene—, así que el UPDATE
   * entero se rechaza con 403 antes de escribir nada. Sin representación, el
   * UPDATE pasa. La comprobación de que quedó bien la hace la relectura de
   * abajo, que es más honesta que creerle al eco.
   */
  const escritura = await fetch(`${BASE}/rest/v1/businesses?id=eq.${businessId}`, {
    method: 'PATCH',
    headers: { ...cabeceras, prefer: 'return=minimal' },
    body: JSON.stringify(cuerpo),
  });
  if (!escritura.ok) abortar(`la escritura respondió ${escritura.status}: ${await escritura.text()}`);

  // Releer de la base, no creerle al eco del PATCH.
  const despues = await leer();
  paso('RELECTURA');
  let sano = true;
  for (const campo of CAMPOS) {
    const valor = despues[campo];
    if (campo === 'alcohol_sales_enabled') {
      if (valor !== false) { mal(`${campo} quedó en ${JSON.stringify(valor)} y tenía que quedar en false`); sano = false; }
      else ok(`${campo} = false · la venta sigue cerrada, como corresponde`);
      continue;
    }
    const esperado = declarada[campo];
    const coincide = campo.endsWith('_start') || campo.endsWith('_end')
      ? mismaHora(valor, esperado)
      : String(valor) === String(esperado);
    if (coincide) ok(`${campo} = ${JSON.stringify(valor)}`);
    else { mal(`${campo} = ${JSON.stringify(valor)} · esperaba ${JSON.stringify(esperado)}`); sano = false; }
  }
  if (!sano) abortar('la relectura no coincide con lo declarado.');

  paso('RESULTADO');
  ok('política cargada y auditada. Quedan DOS compuertas, las dos humanas:');
  info('1. la habilitación comercial de expendio de bebidas alcohólicas del local;');
  info('2. confirmar que el horario 09:00–23:00 sigue vigente en Neuquén Capital.');
  info('Con las dos acreditadas, alcohol_sales_enabled se enciende A MANO.');
} finally {
  if (token) {
    try {
      await fetch(`${BASE}/auth/v1/logout`, { method: 'POST', headers: { apikey, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      info('sesión cerrada (token revocado)');
    } catch (error) {
      info(`no pude revocar el token: ${error.message}. Caduca solo en una hora.`);
    }
  }
}
process.exit(salida);
