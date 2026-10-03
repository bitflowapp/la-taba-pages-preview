// CERTIFICACIÓN E-COMMERCE — conexión directa a la base de un destino propio.
//
// Los destinos `local` y `stack` tienen la base en la misma máquina. Por una conexión
// directa pasan dos cosas, y sólo esas:
//
//   · el OBSERVADOR: cada lectura corre como UNA sentencia (protocolo extendido) dentro
//     de `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`, y devuelve los tipos como los
//     devuelve la Management API de Staging (instantes y fechas como texto de Postgres,
//     `int8` como número cuando entra), porque el runner compara esos textos;
//   · una INTERVENCIÓN anotada (envejecer una fila para no esperar un plazo de minutos):
//     una sentencia con parámetros dentro de una transacción propia, con nombre, que el
//     que llama deja escrita en el ledger.
//
// Una sola conexión, en serie. Si se cae, la próxima llamada abre otra.
import pg from 'pg';

const RAW_TEXT_TYPES = Object.freeze([pg.types.builtins.DATE, pg.types.builtins.TIMESTAMP, pg.types.builtins.TIMESTAMPTZ, pg.types.builtins.INTERVAL]);
export const MANAGEMENT_TYPES = Object.freeze({
  getTypeParser(oid, format) {
    if (format !== 'binary' && RAW_TEXT_TYPES.includes(oid)) return (value) => value;
    if (format !== 'binary' && oid === pg.types.builtins.INT8) return (value) => (Number.isSafeInteger(Number(value)) ? Number(value) : value);
    return pg.types.getTypeParser(oid, format);
  },
});

export function createDirectDatabase({ connect }) {
  let db = null;
  let queue = Promise.resolve();
  const stats = { reads: 0, writes: 0 };
  const withDb = (task) => {
    const run = async () => {
      if (!db) {
        const client = await connect();
        client.on('error', () => { if (db === client) db = null; });
        await client.query("set time zone 'UTC'");   // la base de Staging corre en UTC
        db = client;
      }
      const client = db;
      try { return await task(client); } catch (error) {
        // Sin conexión no hay transacción que cerrar: la próxima llamada abre otra.
        if (!error?.code || /^(08|57P)/.test(error.code)) { db = null; client.end().catch(() => {}); }
        throw error;
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  };
  // Lo que la tarea no confirmó se deshace; después de un COMMIT el ROLLBACK no hace nada.
  const transaction = (begin, task) => withDb(async (client) => {
    await client.query(begin);
    try { return await task(client); } finally { await client.query('rollback').catch(() => {}); }
  });
  // El SQL del observador: UNA sentencia dentro de una transacción de sólo lectura.
  const readOnly = (sql) => { stats.reads += 1; return transaction('begin transaction read only',
    async (client) => (await client.query({ text: sql, types: MANAGEMENT_TYPES, queryMode: 'extended' })).rows); };
  // Una escritura deliberada: UNA sentencia con parámetros, confirmada. Devuelve cuántas filas tocó.
  const write = (sql, params = []) => { stats.writes += 1; return transaction('begin', async (client) => {
    const result = await client.query({ text: sql, values: params, queryMode: 'extended' });
    await client.query('commit');
    return { rowCount: result.rowCount ?? 0, rows: result.rows ?? [] };
  }); };
  return { stats, withDb, transaction, readOnly, write, async close() { await queue; if (db) await db.end().catch(() => {}); db = null; } };
}
