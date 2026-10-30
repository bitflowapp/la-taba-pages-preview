# Cierre técnico de Mercado Pago — 30/10/2026

**NO-GO para vincular a Walter hoy, para mover dinero real y para abrir al público.** La vinculación está implementada y probada sin la llave de cobro, pero todavía no existe el backend productivo al que debe volver Walter. R-MKT-1 contra Mercado Pago sigue pendiente del consentimiento de B y de un APRO manual. No se declara certificada la devolución por API.

Trabajo sobre `bitflowapp/la-taba-pages-preview`, rama `audit/mp-activation-closure-20261030`, apilada sobre #160. No se fusionó, desplegó, contrató ni habilitó nada. Las consultas alojadas fueron de lectura. No se pidieron ni almacenaron contraseñas de vendedores, no se crearon cuentas, preferencias, pagos ni devoluciones.

## PR, ramas y CI

| PR | Cabeza auditada | Base | Resultado vigente |
|---|---|---|---|
| #156 | `30af95c1` | `feature/taba-catalog-transformation-20261024` | Abierta. Su afirmación de software terminado fue superada por defectos de #157/#158. La CI verde anterior es `158ae943`, run 40251561069; no certificar la cabeza por esa corrida. |
| #157 | `a6f3455a` | #156 | Abierta. Run 40268497207 falló; el problema del claim se corrigió en #158. |
| #158 | `68e56906` | #157 | Abierta. Run [40392316077](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/40392316077), 4 jobs verdes. |
| #159 | `e2f6e9b7` | #158 | Abierta. Run [40400371597](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/40400371597) verde sobre código `c8ddedec`; después, documentación. |
| #160 | `8fd65827` | #159 | Abierta. No había una corrida propia; las PR apiladas no disparaban `ci.yml`. Sus herramientas se incluyen en las 367 pruebas de la CI nueva. |

`main` sigue en `ff55f4cf`. El watchdog programado falla consultando el backend retirado; eso no equivale a una falla del código candidato. Reapuntarlo y publicar el backend nuevo requieren la autorización de producción que esta tarea prohíbe asumir. No se apagó ni se alteró el vigía.

Nueva CI [41008760492](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/41008760492), código **`2be348ab81486db80b8c3b5b625fe389ccd714b5`**:

- Herramientas: 367 pruebas, 366 aprobadas, una omitida por plataforma, cero fallas. En Windows local: 367/367.
- SQL: **119/119** sobre las 179 migraciones, clúster propio en loopback. Aislamiento, candado del piloto, conciliación, concurrencia, claim de preferencias, ambigüedad y devoluciones. Desde ahora corre automáticamente para cambios relevantes en PR.
- `npm run check`: verde, sin credenciales detectadas.
- 21 regresiones nuevas; tres mutaciones detectadas: aceptar desconocidos, aceptar una baja de stock aproximada y aceptar una lectura financiera truncada.

La primera corrida nueva falló al crear el socket de PostgreSQL en un directorio del sistema. Se corrigió para usar el directorio del runner; la corrida citada terminó verde. No se ocultó ni se interpretó esa falla como prueba financiera aprobada.

No se repitieron el E2E de navegador, el banco Docker, la restauración ni todos los chequeos Edge: **no hay cambios en `supabase/functions`, `supabase/migrations` ni `js` desde `c8ddedec`**. Se conserva la evidencia verde de #159: 18 escenarios de prueba y 18 de ensayo productivo con proveedor emulado. Esa evidencia NO sustituye un pago de B contra Mercado Pago.

## Defectos reales corregidos

| Defecto | Riesgo | Corrección y evidencia |
|---|---|---|
| `verify` aceptaba `null`, omitía la línea base y no exigía que un aviso válido estuviera completado | Falso certificado de R-MKT-1 | `marketplace-proof.mjs`, `qa-mp-marketplace.mjs`: todos los criterios deben ser verdaderos; baseline v2 anterior al checkout, pedido leído positivamente y aviso completado en B. Salida 1 ante cualquier falla. |
| La búsqueda del vendedor A consideraba un error o una respuesta incompleta como cero pagos | Falso aislamiento del proveedor | Exige HTTP 200, lista vacía y total cero; B debe poder buscar el pago. 403/404 sólo prueba la denegación de lectura directa. |
| Cualquier baja de stock de B parecía suficiente | Deducción errónea o ajena podía certificarse | Delta exacto por id de producto y cantidad del checkout, reservas convertidas una vez y ningún cambio de otros productos ni del comercio A. |
| `replay-webhook` aceptaba cero rutas, rutas nulas y no salía con error | Falso certificado de enrutamiento | Exige la ruta original positiva, duplicado con recibo real, tres respuestas aceptadas y la intención original intacta. |
| Preflight leía sólo pagos recientes y listas acotadas sin comprobar integridad | Un reembolso ambiguo de un pago antiguo o una página truncada podía quedar oculto | Todas las intenciones del comercio y entorno, conteos exactos, rechazo de truncamiento; vencimiento desconocido bloquea. La regresión simula un pago completado antiguo con refund todavía ambiguo. |
| El preflight pedía crear otra cuenta y guardar un login aunque B ya existe | Trabajo innecesario y contrario a este encargo | Ahora pide el consentimiento de la cuenta existente en su propio navegador. No se usa `guardar-vendedor-b.mjs`. |

La lectura completa falla cerrada si supera el máximo de filas del API; no presenta un reporte parcial como limpio. Para grandes volúmenes hará falta paginar antes de poder certificar. No hay ese bloqueo en los datos actuales.

## Estado alojado, leído el 30/10

- Sólo se inspeccionó el proyecto QA `ixewllzzuzpqrkxzmfzx`. Los proyectos ajenos no se consultaron ni modificaron.
- **179/179** versiones y SHA-256 del registro de migraciones coinciden con los archivos locales.
- Las **nueve funciones** están ACTIVE; cada fuente desplegada y sus dependencias coinciden por SHA-256 normalizado a LF con el repositorio. Versiones: connect 16, callback 15, checkout 13, preferencia 15, estado 14, webhook 19, worker 16, refund 16, cancelación 15.
- 17 intenciones, todas `test`: 3 completadas, una devuelta, 3 canceladas y 10 vencidas. 649 tareas completadas, cero pendientes; cero discrepancias. B: cero pedidos y cero intenciones.
- Ambos comercios QA cerrados. A conectado a `3594962708` (también dueña de TestApp); B desconectado. Cuenta B principal `3796774164` y reserva `3796774158`: identidades argentinas distintas verificadas. La API pública no prueba que B sea de prueba: debe confirmarlo su titular antes de consentir/pagar.
- 16 tablas financieras/OAuth con RLS activo y sin SELECT directo para `anon` o `authenticated`. Las siete RPC privilegiadas examinadas sólo son ejecutables por `service_role`.
- Worker, barrido del proveedor, expiración de checkout, alertas y cierre de ventana activos. Retención de seguridad continúa apagada como en la evidencia anterior; antes de producción hay que fijar su política y comprobarla.
- Red QA: 7 comprobaciones positivas y dos no verificables por Basic Auth. `ok:true` del asistente tolera esos dos saltos: **no es 9/9 certificado**.
- Preflight del piloto en B: **bloqueado** por conexión, vencimiento, configuración y candado del piloto de prueba ausentes. No se cambia su alcance para fabricar un verde. El candado productivo se aplica por defecto; se probó en SQL y en el banco previo.
- Registro productivo: `not_provisioned`, sin ref. El preflight productivo se detiene antes de tocar un backend. No hay enlace productivo verificable para Walter.

Los avisos del advisor se conservaron sin denominarlos vulnerabilidades automáticamente: RLS sin políticas en tablas sólo de servicio e inventario de funciones SECURITY DEFINER públicas. Los permisos financieros concretos y las pruebas de autorización se detallan en `evidencia/qa-estado.json`; no se afirma que todo el advisor esté limpio.

## Qué certifica y qué no

| Hito | Veredicto de hoy | Para cambiarlo |
|---|---|---|
| Código de OAuth y vinculación sin activar cobros | **GO técnico** del código; **NO-GO operativo para Walter hoy** | Proyecto/binding/callback/app productivos verificados, secretos sin llave final y sitio publicado con autorización explícita. Después, consentimiento de Walter en su dispositivo. |
| R-MKT-1 real en QA | **NO-GO de certificación**, automatización preparada | Consentimiento B + APRO manual; verificador completo y cuatro replays verdes, conciliación y stock exactos. |
| Piloto controlado con dinero real | **NO-GO** | R-MKT-1 cerrado, preflight completo incluido lo manual, infraestructura autorizada, Walter vinculado, autorización escrita de una compra y su devolución. |
| Apertura comercial | **NO-GO** | Compra y devolución controladas con evidencia, ausencia de bloqueos críticos y aprobación comercial separada de Walter. Ninguna de estas PR abre al público. |

El refund por API histórico llegó al proveedor y recibió 401/cause 7. No se repitió ese rechazo conocido. La devolución externa histórica conciliada prueba ese camino en QA, no certifica la API de producción. Si el refund API falla en el futuro piloto, la devolución desde la cuenta del vendedor puede cerrar la operación con evidencia, pero **la capacidad de reembolso por API sigue sin certificarse**.

La consulta `quality_checklist` oficial para TestApp falló por ownership OAuth: la conexión disponible pertenece a otro propietario. No se probó otra aplicación ni se extrajeron credenciales. No hubo evaluación oficial de pago ni envío de homologación; no hay puntuación ni certificación oficial que informar.

## Procedimientos y evidencia

Ejecutar [PREFLIGHT.md](PREFLIGHT.md). Walter tiene [WALTER.md](WALTER.md). Estos documentos sustituyen, para la decisión de activación actual, las afirmaciones históricas de que sólo faltaba encender un interruptor.

`evidencia/`: hashes de migraciones y fuentes Edge, estado financiero/privilegios, identidades, red, configuración, rechazos de preflight, mutaciones y referencias de CI reutilizadas. `MANIFEST.sha256` permite comprobar integridad. No contiene tokens, claves, contraseñas ni enlaces OAuth de sesión.

## Mercado Pago Integration Review

**Scope**: security. **API detected**: Checkout Pro preferences y Payments API para lecturas, conciliación y devoluciones. **Products detected**: Checkout Pro marketplace con OAuth. No se considera legacy la API de preferencias.

**Files analyzed**: `mercadopago-connect/index.ts`, `mercadopago-oauth-callback/index.ts`, `_shared/seller-oauth*.ts`, `_shared/seller-webhook-routing.ts`, `_shared/mercadopago*.ts`, handlers de checkout/webhook/worker/refund, migraciones y herramientas del piloto y QA.

### CRITICAL

- Infraestructura/callback productivos ausentes; prueba marketplace de B y devolución API real sin certificar. Bloquean activación comercial.

### WARNINGS

- Límites de fallback de enrutamiento: 25 vendedores/10 segundos; excederlos falla cerrado y necesita conciliación. Más de 10.000 pagos empatados no cierra la ventana del ledger por diseño.
- Muerte del despachador tras claim puede dejar al comprador esperando hasta vencer el checkout; no se reenvía un POST incierto.
- Correo/push operativo y política de retención pendientes de la configuración autorizada de producción. Mantener operador presente durante el piloto.

### PASS

- Verificación de cobrador y referencia con el proveedor, cifrado contextual por comercio/entorno/app, state OAuth de un uso y PKCE, refresh con claim, control de permisos, reservas y confirmación por servidor.
- Aislamiento financiero, deduplicación, devoluciones ambiguas y candado de compra única cubiertos por SQL/CI; fuente alojada sin drift.

### Quality Standards

No verificados: la consulta oficial fue rechazada por ownership. No se inventan filas ni puntuaciones oficiales.

### Security checklist (cross-cutting)

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | Tokens sólo servidor, sin credenciales asignadas en código | PASS | `seller-oauth.ts`, `payment-runtime.ts`, escáner verde |
| 2 | `.env` ignorados, ejemplos permitidos | PASS | `.gitignore` |
| 3 | Firma HMAC-SHA256 y ventana de tiempo | PASS | `mercadopago-webhook-signature.ts`, CI previa sin cambios; seis firmas falsas históricas rechazadas |
| 4 | HTTPS para retorno/notificación | PASS | `mercadopago.ts`, `seller-oauth.ts`, sonda TLS QA |
| 5 | Estado confirmado en servidor | PASS | worker, checkout-status, ledger; SQL/CI |
| 6 | Idempotencia en operaciones financieras | PASS | claims atómicos y claves de refunds; SQL concurrencia |
| 7 | Referencia externa por compra | PASS | `taba2:checkout:<uuid>` en preferencia y verificación |
| 8 | Cuentas de prueba aisladas de binding productivo | PASS | `environments.json`, binding y ensayo de #159 |
| 9 | Checkout usa `init_point` del proveedor | PASS | handler de preferencias; campos históricos `sandbox_init_point` no seleccionan el destino del comprador |

**Summary**: Official quality: not verified. 9/9 controles de código examinados; eso no equivale a aprobar los hitos operativos pendientes.

## Implementation Report

### Verified

- [x] Estado real de #156–#160, CI y drift de QA; 179 migraciones y nueve funciones coincidentes.
- [x] Verificadores de marketplace/replay y preflight corregidos; 21 regresiones y tres mutaciones.
- [x] 119 regresiones SQL ahora en CI, 367 pruebas de herramientas cubiertas; ninguna operación con dinero.

### Needs attention

- [ ] Consentimiento del vendedor B y APRO por una persona; verificación completa posterior.
- [ ] Homologación/calidad oficial no verificada por ownership del conector.
- [ ] Revisión de los commits y de la cadena apilada, sin fusionarla en este encargo.

### Blockers (must fix before production)

- [ ] Crear, configurar y publicar producción requiere autorización explícita y presupuesto aprobado.
- [ ] Consentimiento de Walter, aprobación de compra/devolución y certificación efectiva. Refund API todavía sin prueba satisfactoria.

### Next steps

1. Titular de B consiente y comprador ejecuta APRO de prueba; seguir PREFLIGHT, sin compartir claves.
2. Revisar el resultado completo y decidir infraestructura productiva; no activar pagos en esta sesión.
3. Walter sigue WALTER.md cuando la vinculación esté disponible. Piloto y apertura requieren aprobaciones separadas.

### Resources used

- Código, lecturas Supabase/GitHub, CI, evidencia de QA y banco anterior.
- [OAuth oficial](https://www.mercadopago.com.ar/developers/es/docs/security/oauth/introduction), [webhooks oficiales](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks), [changelog Supabase](https://supabase.com/changelog).
- Skills: `mp-review` v4.3.2, `mp-integrate`, `mp-webhooks`, `supabase`.
- MCP: `quality_checklist`, 30/10/2026, rechazado por ownership; sin resultados oficiales.

**Scores**: official quality N/A; 9/9 controles de código. **Verdict**: Blocked para activación productiva; automatización preparada para completar QA con intervención humana.
