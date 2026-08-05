// Corre la jornada sintética y deja la evidencia en disco.
// No toca producción, Mercado Pago real ni ARCA externo: todo el backend es en memoria.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runCertification } from '../tests/synthetic/scenarios.mjs';
import { QA_MARKERS } from '../tests/synthetic/qa-fixtures.mjs';

// Ruta relativa al repositorio por defecto: una ruta de disco local no puede vivir en el árbol.
const OUT = path.resolve(process.env.TABA_CERT_OUT_DIR || 'artifacts/la-taba-business-synthetic-certification');
const stampedAt = process.env.TABA_CERT_STAMP || new Date().toISOString();

mkdirSync(OUT, { recursive: true });
const certification = await runCertification();

const totalChecks = certification.scenarios.reduce((total, scenario) => total + scenario.checks.length, 0);
const failedChecks = certification.scenarios.flatMap((scenario) => scenario.checks
  .filter((entry) => !entry.ok)
  .map((entry) => ({ scenario: scenario.title, ...entry })));

writeFileSync(path.join(OUT, 'resultados.json'), `${JSON.stringify({
  stampedAt,
  passed: certification.passed,
  totalChecks,
  failedChecks,
  scenarios: certification.scenarios,
  cleanup: certification.cleanup,
}, null, 2)}\n`);

writeFileSync(path.join(OUT, 'matriz.md'), buildMatrix());
writeFileSync(path.join(OUT, 'cleanup.md'), buildCleanup());

console.log(`Certificación sintética: ${certification.passed ? 'PASS' : 'FAIL'} · ${totalChecks - failedChecks.length}/${totalChecks} comprobaciones`);
console.log(`Evidencia en ${OUT}`);
if (failedChecks.length) process.exitCode = 1;

function buildMatrix() {
  const rows = certification.scenarios.map((scenario) => {
    const passed = scenario.checks.filter((entry) => entry.ok).length;
    return `| ${scenario.id} | ${scenario.title} | ${passed}/${scenario.checks.length} | ${scenario.passed ? 'PASS' : 'FAIL'} |`;
  }).join('\n');
  const detail = certification.scenarios.map((scenario) => {
    const lines = scenario.checks
      .map((entry) => `- [${entry.ok ? 'x' : ' '}] ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`)
      .join('\n');
    return `### ${scenario.id}. ${scenario.title}\n\n${lines}\n`;
  }).join('\n');

  return `# Matriz de certificación sintética del panel

Jornada completa ejecutada contra un backend en memoria que reproduce las invariantes del
servidor (idempotencia, revisión esperada, un pedido por pago, ledger de stock). **No se tocó
producción, Mercado Pago real ni ARCA externo.** Todos los datos llevan etiqueta QA:
${Object.values(QA_MARKERS).map((marker) => `\`${marker}\``).join(', ')}.

Ejecutada: ${stampedAt}

| # | Escenario | Comprobaciones | Resultado |
|---|---|---|---|
${rows}
| — | **Total** | **${totalChecks - failedChecks.length}/${totalChecks}** | **${certification.passed ? 'PASS' : 'FAIL'}** |

## Detalle

${detail}
## Alcance y límites

Esta certificación prueba **el panel**, no la base de datos. El backend sintético existe para
poder recorrer una jornada completa; las invariantes que aparecen abajo las garantiza el
servidor y aquí sólo se reproducen para verificar que el panel se comporta bien frente a ellas.

| Invariante | Dónde se garantiza de verdad | Qué certifica esta corrida |
|---|---|---|
| Un pago aprobado produce un solo pedido | \`finalize_paid_checkout_session\` | Que reintentar la recuperación desde el panel no duplica el pedido |
| El stock no se descuenta dos veces | \`apply_inventory_movement\` y su ledger inmutable | Que el panel no dispara un segundo descuento al reintentar |
| La revisión esperada evita pisar cambios ajenos | \`transition_order\`, \`start_packing_session\` | Que el panel manda la revisión y traduce el conflicto sin jerga |
| Una lectura de packing pertenece al pedido | \`record_packing_scan\` | Que el panel no cuenta un producto ajeno ni confirma con faltantes |
| Publicar producto exige owner/admin | \`publish_catalog_product_draft\` | Que el panel no ofrece la acción al equipo |
| Homologación exige la frase exacta | \`authorize_arca_homologation\` | Que el panel no la deja pasar con otro texto |

Lo que **no** cubre esta corrida:

- La aplicación real de esas reglas contra PostgreSQL. Ese gate se declara por separado y no
  se da por aprobado si no se ejecutó.
- Impresión física: ninguna comprobación afirma que haya salido papel. El escenario 5 verifica
  justamente lo contrario, que un trabajo aceptado por el spooler se reporte como enviado.
- GPS real del repartidor: el escenario 7 recorre la asignación y el cierre sin posición física.

La facturación permanece en homologación en todos los fixtures; no hay ruta de producción.
`;
}

function buildCleanup() {
  const { cleanup } = certification;
  return `# Limpieza posterior a la jornada sintética

| Verificación | Resultado |
|---|---|
| Pedidos QA activos | ${cleanup.activeQaOrders} |
| Stock QA restaurado | ${cleanup.stockRestored ? 'sí' : 'NO'} |
| Locks abiertos | ${cleanup.openLocks} |
| Cola QA pendiente | ${cleanup.pendingQaOutbox} |
| Productos QA archivados | ${cleanup.archivedQaProducts} |
| Usuarios QA intactos | ${cleanup.qaUsersIntact ? 'sí' : 'NO'} |
| Operaciones humanas modificadas | ${cleanup.humanOperationsTouched} |

Estado: ${cleanup.ok ? 'LIMPIO' : 'REQUIERE REVISIÓN'}

Los productos creados durante la jornada quedaron archivados y no comprables. El stock de los
productos QA sembrados volvió a su valor inicial. No se modificó ninguna operación humana:
el backend sintético vive sólo en memoria durante la corrida.
`;
}
