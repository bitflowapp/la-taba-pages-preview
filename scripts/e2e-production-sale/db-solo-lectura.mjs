/*
 * La única puerta a la base durante la prueba, y es de una sola dirección.
 *
 * El harness mide ANTES y DESPUÉS —stock, estado del pedido, movimientos— pero
 * no arregla nada: si el flujo real no produjo el efecto, el resultado es una
 * falla, no una reparación. Por eso este módulo NO PUEDE escribir aunque quien
 * lo use se equivoque: rechaza toda sentencia que no sea un SELECT.
 *
 * Es deliberadamente más estricto que el runner general del proyecto: acá ni
 * siquiera se aceptan varias sentencias, ni `with` con escritura adentro, ni
 * llamadas a funciones que muten.
 */
import { conToken } from '../lib/supabase-cli-token.mjs';
import { PRODUCCION } from './contrato.mjs';

const PALABRAS_DE_ESCRITURA = [
  'insert', 'update', 'delete', 'truncate', 'alter', 'create', 'drop', 'grant', 'revoke',
  'copy', 'vacuum', 'refresh', 'reset', 'do', 'call', 'merge', 'lock', 'comment', 'reindex',
  'begin', 'commit', 'rollback', 'savepoint', 'listen', 'notify', 'prepare', 'execute',
];
// Funciones que escriben aunque se las llame desde un select.
const FUNCIONES_QUE_MUTAN = /\b(apply_inventory_movement|set_commercial_product_publication|transition_order|acknowledge_order|cancel_order|assign_order_rider|offer_order_to_rider|create_|submit_|confirm_|start_|revert_|close_|prepare_daily|identity_register|rider_)/i;

export class ConsultaNoPermitida extends Error {}

export function assertSoloLectura(sql) {
  const texto = String(sql || '');
  const limpio = texto
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
  const normalizado = limpio.toLowerCase();
  if (!limpio) throw new ConsultaNoPermitida('consulta vacía');
  if (!/^(select|with)\b/.test(normalizado)) {
    throw new ConsultaNoPermitida(`sólo SELECT: la consulta empieza con «${normalizado.split(/\s/)[0]}»`);
  }
  if (limpio.replace(/;\s*$/, '').includes(';')) {
    throw new ConsultaNoPermitida('una sola sentencia por consulta');
  }
  for (const palabra of PALABRAS_DE_ESCRITURA) {
    // Se busca la palabra como sentencia, no como parte de un nombre de
    // columna: `updated_at` es legítimo, ` update ` no.
    if (new RegExp(`(^|[\\s(])${palabra}\\s`, 'i').test(` ${normalizado} `)) {
      throw new ConsultaNoPermitida(`palabra de escritura prohibida: ${palabra}`);
    }
  }
  if (FUNCIONES_QUE_MUTAN.test(normalizado)) {
    throw new ConsultaNoPermitida('la consulta invoca una función que puede mutar');
  }
  return limpio;
}

export async function consultar(sql) {
  const seguro = assertSoloLectura(sql);
  return conToken(async (token) => {
    const respuesta = await fetch(`https://api.supabase.com/v1/projects/${PRODUCCION.supabaseRef}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'taba2-production-sale-e2e/1.0 (read-only)',
      },
      body: JSON.stringify({ query: seguro }),
    });
    const texto = await respuesta.text();
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} · ${texto.slice(0, 500)}`);
    return texto ? JSON.parse(texto) : [];
  });
}

export const lit = (valor) => `'${String(valor).replaceAll("'", "''")}'`;
