# La Taba · Recuperación ante desastre fiscal

Qué hacer si se pierde la PC del mostrador y qué pasa si se pierde la base.

Complementa `docs/LOCAL-AGENT-RUNBOOK.md` (instalar, registrar y revocar el agente) y
`docs/TABA-COMMERCIAL-FISCAL-V2.md` (cómo se factura un pedido).

Estado honesto:

- Los procedimientos están probados sobre el esquema real, en PostgreSQL 17 local con el shim
  de Supabase (PG17+shim).
- Las autorizaciones son SIMULADAS y los agentes de impresión también.
- No se hizo un restore de producción ni se probó una impresora física.

## 0. El principio: nada fiscal vive solo en la PC

| Qué | Dónde vive | ¿Se pierde con la PC? |
|---|---|---|
| Comprobante: CAE, vencimiento, número, totales, ítems | `fiscal_documents`, `fiscal_document_items` (Supabase) | No |
| Origen congelado del pedido o venta | `fiscal_source_snapshots`, con `snapshot_hash` | No |
| Historia: eventos, actor y canal de cada pedido, intentos con ARCA | `fiscal_events`, `fiscal_idempotency_keys`, `fiscal_request_attempts` | No |
| PDF autorizado | Storage privado `fiscal-documents`; ruta y sha256 en `fiscal_document_artifacts` | No |
| Pedidos y trabajos de impresión, reimpresiones | `fiscal_print_requests`, `print_jobs` (`reprint_of`, motivo, quién) | No |
| Credencial del agente, diario local, impresoras elegidas | la PC: `%ProgramData%\TabaLocalAgent` | Sí, y se reemplaza |

La PC imprime lo que el servidor le da. Perderla no pierde ninguna factura.

## 1. La PC del mostrador se rompe, se pierde o la roban

Orden: primero cortar la PC vieja, después instalar la nueva.

1. **Revocar la PC vieja.** Lo hace el dueño o un administrador:
   `revoke_local_device(<device_id>, '<motivo>')`, o
   `node scripts/print-agent/dispositivos.mjs revocar --target=<entorno> --device=<uuid> --motivo="PC robada"`.
   El efecto es inmediato:
   - su credencial deja de valer;
   - lo que había reclamado sin empezar vuelve a la cola;
   - lo que estaba imprimiendo queda `needs_review`.
2. **Revisar `needs_review`.** Una persona decide "salió" o "no salió"
   (`resolve_print_job_review`). No se reimprime solo.
3. **Instalar el agente en la PC nueva** (runbook §1): verificar el SHA-256 del MSI antes de
   instalar.
4. **Registrarla con un código nuevo** (runbook §2): `create_local_device_pairing`, y después
   `TabaLocalAgent register --code …`. Queda otro dispositivo con otra credencial.
5. **Impresoras y hoja de prueba** (runbook §3 y §4).
6. **Historia.** El Panel la lee del servidor (bandeja de pedidos y Comprobantes): estado, número,
   CAE, PDF e impresiones. No hay nada que importar.
7. **Reimprimir una factura vieja** con **Reimprimir** en la tarjeta del pedido, o
   `request_print_job_reprint(<trabajo>, '<motivo>', '<clave>')`:
   - es un trabajo nuevo con `reprint_of`;
   - el ticket sale como DUPLICADO, con el mismo CAE;
   - **nunca** se pide otro CAE;
   - repetir el pedido con la misma clave no duplica.
8. **Emitir una factura nueva** como siempre: su primer ticket sale por la PC nueva.
9. **Si también se perdió un teléfono vinculado a WhatsApp** (PR de WhatsApp): desvincularlo desde
   el Panel, en Comprobantes › WhatsApp de facturación.

Chequeo al terminar:

- el Panel dice que la PC de impresión está conectada;
- la PC vieja figura revocada y su credencial no entra;
- no queda nada en `needs_review` sin decidir;
- una reimpresión de prueba sale como DUPLICADO;
- la próxima factura imprime por la PC nueva.

Esto lo recorre entero `supabase/tests/fiscal_disaster_recovery_test.sql`.

## 2. Se pierde la base (Supabase)

### 2.1 Lo que no se verificó acá (HUMAN_ACTION_REQUIRED)

El restore de producción es de Supabase: backups diarios o PITR, según el plan del proyecto.
Una persona con acceso tiene que confirmar:

- qué plan hay, cuánta retención, si PITR está activo y quién puede restaurar;
- **los PDF**: viven en Storage, no en las tablas. El backup de la base guarda su ruta y su hash.
  Hay que confirmar con Supabase cómo se respalda Storage en ese plan. Si un PDF se pierde pero
  el comprobante está en la base, se puede regenerar desde el comprobante autorizado
  (`request_fiscal_artifact_regeneration`): queda un artefacto nuevo que reemplaza al anterior;
- **el hueco con ARCA**. Si se restaura a un momento ANTERIOR a la última autorización, ARCA
  puede tener comprobantes que la base ya no tiene. Antes de volver a facturar, para cada punto
  de venta y tipo:
  - consultar el último número autorizado en ARCA (`FECompUltimoAutorizado`);
  - compararlo con la base;
  - recuperar lo que falte con `FECompConsultar` (CAE, fecha, importes).

  Hasta cerrar ese hueco, **no se emite**: un número repetido lo rechaza ARCA, y un comprobante
  autorizado que no está en la base es un comprobante perdido. Este procedimiento no está
  automatizado; lo ejecuta una persona con el contador.

### 2.2 El simulacro local

```sh
TABA_LOCAL_FISCAL_DB=1 PG_BIN=<carpeta con pg_dump y pg_restore 17> \
  node scripts/fiscal-core/fiscal-restore-drill.mjs postgres://postgres@127.0.0.1:55461/<base-origen> <base>_restore
```

Solo usa bases locales descartables; nunca toca producción. Pasos:

1. Siembra, confirmado, un negocio con:
   - una factura autorizada (simulada) de un pedido online;
   - su origen congelado, los metadatos del PDF y sus eventos;
   - un ticket impreso por la PC y una reimpresión pendiente.
2. Resume la integridad fiscal: comprobantes (CAE, vencimiento, número, total), ítems, orígenes
   congelados (hash), artefactos (sha256 y ruta), eventos, claves (canal y actor), pedidos y
   trabajos de impresión, dispositivos y el ledger de migraciones.
3. Corre `pg_dump` en formato custom (con su sha256) y `pg_restore` en una base nueva. Las
   extensiones de la plataforma (programador, red, bóveda) quedan afuera, igual que en el
   simulacro de CI.
4. Exige que el resumen restaurado sea **idéntico** al original.
5. Después del restore, con los roles reales:
   - el Panel lee la factura con su CAE;
   - la factura vieja se reimprime;
   - la próxima factura toma el número siguiente, con otro CAE.

Además, CI ya corre un simulacro de dump y restore de la base entera en
`scripts/run-release-v5-db.mjs`, con la imagen de Postgres de Supabase.

## 3. Checklist imprimible

PC perdida o rota:

- [ ] revocar la PC vieja (dueño o admin), anotar el motivo;
- [ ] decidir cada `needs_review`;
- [ ] PC nueva: MSI verificado, instalado y registrado con código nuevo;
- [ ] impresoras configuradas y hoja de prueba impresa;
- [ ] una reimpresión de prueba sale como DUPLICADO, con el mismo CAE;
- [ ] la próxima factura imprime por la PC nueva;
- [ ] si se perdió un teléfono vinculado, desvincularlo.

Base perdida (solo con Supabase y el contador):

- [ ] confirmar el punto de restore y que Storage también está respaldado;
- [ ] restaurar y comparar el ledger de migraciones con el repo;
- [ ] comparar, por punto de venta y tipo, el último número de ARCA con la base; recuperar lo que
  falte **antes** de facturar;
- [ ] regenerar los PDF que falten desde sus comprobantes;
- [ ] reimprimir una factura vieja de prueba; emitir una nueva y verificar número y CAE.

## 4. Evidencia

| Prueba | Qué fija | Resultado |
|---|---|---|
| `supabase/tests/fiscal_disaster_recovery_test.sql` (pgTAP, 21, CI) | factura autorizada e impresa → PC destruida y revocada → el Panel lee todo del servidor → PC nueva → reimpresión de la factura vieja (mismo CAE, `reprint_of`, sin CAE nuevo) → factura nueva por la PC nueva → pasos repetidos no duplican | PASS (PG17+shim) |
| `supabase/tests/local_print_agent_test.sql` (CI) | revocación: credencial inválida, reclamados a la cola, ningún secreto conservado | PASS |
| `scripts/fiscal-core/fiscal-restore-drill.mjs` (local) | `pg_dump`/`pg_restore` reales; integridad fiscal idéntica; historia, reimpresión y numeración después del restore | PASS (`pg_dump`/`pg_restore` 17.10 sobre PG17+shim; dump de 2 MB, restore en 6 s) |
| Simulacro de CI (`run-release-v5-db.mjs`) | dump y restore de la base entera, compuerta de plataforma cerrada | CI |

No verificado: PHYSICAL_PRINT, el restore de producción, el backup de Storage y el cierre del
hueco con ARCA real.
