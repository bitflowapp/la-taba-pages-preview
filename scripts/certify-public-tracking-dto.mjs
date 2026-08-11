/*
 * Certifica el contrato PUBLICO del seguimiento contra lo que quedo DESPLEGADO,
 * leyendo el cuerpo de la funcion desde el dump del esquema remoto.
 *
 * No alcanza con que la migracion figure en el ledger: lo que importa es que
 * cuerpo tiene la funcion que va a correr.
 *
 *   node scripts/certify-public-tracking-dto.mjs <dump.sql>
 */
import fs from 'node:fs';
import path from 'node:path';

import { evidencia } from './primer-pedido-humano/entorno.mjs';

const dump = fs.readFileSync(process.argv[2], 'utf8');
const cabecera = dump.indexOf('FUNCTION "public"."get_public_order_tracking"');
if (cabecera < 0) { console.log('no encontre get_public_order_tracking en el dump'); process.exit(1); }
const abre = dump.indexOf('AS $$', cabecera);
const cierra = dump.indexOf('$$;', abre + 5);
if (abre < 0 || cierra < 0) { console.log('no pude delimitar el cuerpo de la funcion'); process.exit(1); }
const declaracion = dump.slice(cabecera, abre);
const cuerpo = dump.slice(abre, cierra);

const chequeos = {
  'redondea la latitud a 4 decimales': /round\(rl\.lat::numeric, 4\)/.test(cuerpo),
  'redondea la longitud a 4 decimales': /round\(rl\.lng::numeric, 4\)/.test(cuerpo),
  'no quedo ningun redondeo a 3 decimales': !/::numeric, 3\)/.test(cuerpo),
  'entrega captured_at': /'captured_at', coalesce\(rl\.captured_at, rl\.created_at\)/.test(cuerpo),
  'ordena por captura, no por llegada': /order by coalesce\(rl\.captured_at, rl\.created_at\) desc/.test(cuerpo),
  'desempata por receipt_sequence': /rl\.receipt_sequence desc limit 1/.test(cuerpo),
  'no expone receipt_sequence en el DTO': !/'receipt_sequence'/.test(cuerpo),
  'no expone coordenada cruda': !/'lat', rl\.lat[^:]/.test(cuerpo) && !/'lng', rl\.lng[^:]/.test(cuerpo),
  'mide la frescura sobre la captura': /coalesce\(rl\.captured_at, rl\.created_at\) >= clock_timestamp\(\) - interval '3 minutes'/.test(cuerpo),
  'la frescura ya no se mide sobre created_at': !/rl\.created_at >= clock_timestamp\(\)/.test(cuerpo),

  // ---------- lo que NO se debilito al pasar por aca ----------
  'piso de precision de 100 m intacto': /greatest\(100, ceil\(rl\.accuracy\)\)::integer/.test(cuerpo),
  'sigue exigiendo precision entre 0 y 250': /rl\.accuracy between 0 and 250/.test(cuerpo),
  'sigue exigiendo token vivo y no revocado': /opt\.revoked_at is null and opt\.expires_at > clock_timestamp\(\)/.test(cuerpo),
  'sigue comparando por hash de token': /opt\.token_hash = v_token_hash/.test(cuerpo)
    && /request_order_token_hash\(\)/.test(cuerpo),
  'sigue exigiendo el rider asignado': /rl\.rider_user_id = v_order\.assigned_rider_user_id/.test(cuerpo),
  'sigue exigiendo fuente gps': /rl\.source = 'gps'/.test(cuerpo),
  'ubicacion SOLO durante entrega activa': /v_order\.status in \('picked_up', 'on_the_way', 'arrived'\)/.test(cuerpo),
  'sin token no devuelve nada': /if v_token_hash is null[\s\S]{0,80}return null/.test(cuerpo),
  'sigue siendo security definer con search_path fijo': /SECURITY DEFINER/i.test(declaracion)
    && /search_path/i.test(declaracion),
  'no expone telefono, direccion, items ni totales':
    !/customer_phone|customer_street_address|address_label|'total'|order_items/.test(cuerpo),
  'no expone identificadores internos ni de auth':
    !/assigned_rider_user_id'|'customer_user_id'|'business_id'|'id', v_order\.id/.test(cuerpo),
  'no entrega historial: un solo punto': (cuerpo.match(/limit 1/g) || []).length >= 2
    && !/jsonb_agg/.test(cuerpo),
};

console.log('=== CONTRATO PUBLICO DESPLEGADO EN STAGING ===\n');
let todo = true;
for (const [k, v] of Object.entries(chequeos)) {
  if (!v) todo = false;
  console.log(`${v ? 'OK   ' : 'FALLA'} ${k}`);
}
fs.writeFileSync(path.join(evidencia('gate-cliente'), 'dto-certificacion.json'),
  JSON.stringify({ at: new Date().toISOString(), chequeos, cuerpo }, null, 2), 'utf8');
console.log(`\n${todo ? 'CONTRATO DESPLEGADO: CERTIFICADO' : 'HAY CHEQUEOS EN FALLA'}`);
process.exitCode = todo ? 0 : 1;
