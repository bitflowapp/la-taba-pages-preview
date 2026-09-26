import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { leerArgumentos, validar, resumirEstado } from '../scripts/print-agent/dispositivos.mjs';

const NEGOCIO = 'e7850ad2-a447-402c-8375-3fd74e9466ba';
const DISPOSITIVO = '0b2f5a4e-5c1d-4e1b-9f3a-7a1c2d3e4f50';

test('el código de emparejamiento exige destino, negocio, slug y nombre', () => {
  assert.equal(validar(leerArgumentos(['codigo', '--target=controlled-production', `--business=${NEGOCIO}`, '--confirmar=la-taba-cp', '--nombre=Mostrador'])), null);
  assert.equal(validar(leerArgumentos(['codigo', '--target=produccion-vieja', `--business=${NEGOCIO}`, '--confirmar=x', '--nombre=M'])), 'DESTINO_INVALIDO');
  assert.equal(validar(leerArgumentos(['codigo', '--target=controlled-production', `--business=${NEGOCIO}`, '--nombre=M'])), 'FALTA_CONFIRMAR_EL_SLUG');
  assert.equal(validar(leerArgumentos(['codigo', '--target=controlled-production', '--business=no-uuid', '--confirmar=x', '--nombre=M'])), 'NEGOCIO_INVALIDO');
  assert.equal(validar(leerArgumentos(['codigo', '--target=controlled-production', `--business=${NEGOCIO}`, '--confirmar=x', '--nombre='])), 'NOMBRE_INVALIDO');
});

test('revocar exige el dispositivo y un motivo', () => {
  assert.equal(validar(leerArgumentos(['revocar', '--target=controlled-production', `--device=${DISPOSITIVO}`, '--motivo=PC robada'])), null);
  assert.equal(validar(leerArgumentos(['revocar', '--target=controlled-production', `--device=${DISPOSITIVO}`])), 'FALTA_EL_MOTIVO');
  assert.equal(validar(leerArgumentos(['revocar', '--target=controlled-production', '--device=x', '--motivo=porque si'])), 'DISPOSITIVO_INVALIDO');
  assert.equal(validar(leerArgumentos(['borrar-todo', '--target=controlled-production'])), 'COMANDO_INVALIDO');
});

test('el estado resume agentes y cola sin hashes ni contenido de tickets', () => {
  const now = Date.parse('2026-09-26T18:00:00Z');
  const resumen = resumirEstado([
    { id: DISPOSITIVO, device_name: 'Mostrador', status: 'active', agent_version: '0.1.0', last_seen_at: '2026-09-26T17:59:30Z',
      last_report: { printers: [{ name: 'POS-80', role: 'counter', status: 'READY' }] }, secret_hash: 'no-debe-salir' },
    { id: 'x', device_name: 'Cocina', status: 'revoked', agent_version: '0.1.0', last_seen_at: '2026-09-26T10:00:00Z', last_report: {} },
  ], [{ status: 'printed' }, { status: 'printed' }, { status: 'needs_review' }], now);
  assert.equal(resumen.agentes[0].en_linea, true);
  assert.equal(resumen.agentes[1].en_linea, false);
  assert.deepEqual(resumen.cola, { printed: 2, needs_review: 1 });
  assert.doesNotMatch(JSON.stringify(resumen), /no-debe-salir|secret/);
});

test('la herramienta no lee ni imprime hashes de credenciales', () => {
  const source = fs.readFileSync(new URL('../scripts/print-agent/dispositivos.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /secret_hash|pending_secret_hash|code_hash/);
});
