// Corre la jornada sintética y deja la evidencia en disco.
// No toca producción, Mercado Pago real ni ARCA externo: todo el backend es en memoria.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runCertification } from '../tests/synthetic/scenarios.mjs';
import { QA_MARKERS } from '../tests/synthetic/qa-fixtures.mjs';

const OUT = path.resolve(process.env.TABA_CERT_OUT_DIR || 'C:/1212/artifacts/la-taba-business-synthetic-certification');
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

- El backend sintético reproduce las invariantes del servidor pero **no es PostgreSQL**. La
  aplicación real de esas reglas en base está cubierta por los tests de contrato SQL del
  repositorio; su ejecución contra una instancia viva se declara aparte.
- Ninguna impresión afirma salida física: el escenario 5 verifica que un trabajo aceptado por
  el spooler se reporte como enviado y nunca como impreso.
- La facturación permanece en homologación en todos los fixtures; no hay ruta de producción.
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
