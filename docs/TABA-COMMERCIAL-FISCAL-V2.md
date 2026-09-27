# La Taba · Facturar pedidos online (Commercial Fiscal V2)

Rama `feat/taba-commercial-fiscal-v2`, apilada sobre `feat/taba-fiscal-core-adoption` (#112).
Core fiscal fijado: `bitflowapp/taba-fiscal@9fd32fd29dec4ec4c271edd90f4af2ceef73264c`
(PR #3, apilado sobre #2 `d93bcaa` y #1 `26d2f4c`). Ver `docs/TABA-FISCAL-CORE-ADOPTION.md`, sección 15.

Estado honesto:

- Esto se probó en homologación **simulada**: FakeArca del core, PostgreSQL 17 local con el
  shim de Supabase, y la PC de impresión simulada con las RPC reales del agente.
- No se probó contra ARCA real, ni con un certificado, CUIT o punto de venta reales, ni con una
  impresora física.
- La política comercial y las clasificaciones de las pruebas son FIXTURES sintéticos. Ningún
  comercio tiene todavía una política aprobada: en cualquier base real el resultado sigue siendo
  `ACCOUNTING_POLICY_REQUIRED` hasta que la apruebe su contador.

## 1. Qué cambia

Un pedido online se factura **como pedido**: `source_type = 'online_order'`, `source_id = orders.id`.

Antes (#106) el pedido se convertía en una venta POS sintética, con un pago confirmado inventado
y un IVA inventado. Eso ya no existe. El core (PR #3) exige que un `online_order` llegue con un
**origen congelado y validado** (`fiscal_source_snapshots`). La Taba arma ese origen desde los
datos reales del pedido, bajo una política contable declarada. Si falta algo, no se factura y
dice por qué.

```
Panel / celular ── request_order_invoice (authenticated, auth.uid(), PANEL|MOBILE)
WhatsApp / autom ─ service_request_order_invoice (service_role, WHATSAPP|AUTOMATION, actor miembro activo)
        │
        ▼
private.commercial_prepare_order_invoice
   · lock de la intención (el mismo que toma el core)
   · private.commercial_order_fiscal_evaluation  → READY | BLOCKED(razones) | ALREADY_REQUESTED
   · READY: private.fiscal_freeze_source_snapshot (core)
        │
        ▼
public.request_fiscal_document / public.service_request_fiscal_document (core, única ruta de emisión)
        │  outbox
        ▼
worker canónico del core → ARCA (WSFEv1) → authorized
        │  trigger fiscal_documents_fulfill_print_requests
        ▼
fiscal_print_requests (durable) → print_jobs (auto:fiscal_receipt:<doc>) → agente local
```

El adaptador no abre un camino paralelo de emisión. La única ruta a
`private.fiscal_request_invoice` sigue siendo la del core. El contrato de #112 lo verifica
(`fiscal_core_contract_test.sql`).

## 2. Migraciones

| Migración | Qué hace |
|---|---|
| `20260927084439_fiscal_core_online_order_source_snapshots` | Adopta la migración `20260927100000` del core: `online_order` solo desde el origen congelado. Diferencia intencional: sin lectura para `viewer`. |
| `20260927084642_commercial_fiscal_policy` | `commercial_fiscal_policies` (política declarativa por negocio) y `product_fiscal_classifications` (clasificación por producto). Sin defaults. |
| `20260927084646_commercial_order_fiscal_adapter` | La evaluación única, el origen congelado, las entradas `request_order_invoice` y `service_request_order_invoice`, el pedido de impresión durable y `get_order_fiscal_states`. |

## 3. Política comercial declarativa (`commercial_fiscal_policies`)

La decide y la aprueba una persona (el contador del comercio). Una política aprobada no se
edita: se retira y se aprueba otra. Un trigger lo impide (55000).

| Campo | Valores | Qué decide |
|---|---|---|
| `billing_moment` | `after_payment_confirmed`, `after_delivered`, `after_accepted` | cuándo se puede facturar |
| `mercadopago_rule` | `require_approved`, `not_invoiceable` | qué estado de Mercado Pago habilita la factura |
| `cash_rule`, `coordinate_rule` | `require_confirmed`, `allow_pending`, `not_invoiceable` | efectivo y "coordinar" |
| `vat_computation` | `price_includes_vat_per_rate` | cómo se calcula el IVA (única opción implementada) |
| `delivery_treatment` | `invoice_as_line`, `exclude_from_invoice`, `not_invoiceable` | el envío |
| `delivery_vat_code` | 3, 4, 5, 6, 8, 9 (ids oficiales de ARCA) | alícuota del envío si se factura como línea |
| `delivery_line_description` | texto | descripción de esa línea |
| `discount_treatment` | `prorate_by_item_gross`, `not_invoiceable` | los descuentos |
| `final_consumer_id_threshold` | importe | desde qué total hay que identificar al consumidor final |
| `credit_note_policy` | `manual_review_only` | devoluciones y notas de crédito |
| `accountant_reference`, `approved_by`, `approved_at` | — | quién lo decidió y dónde consta |

Cada producto vendible necesita su fila en `product_fiscal_classifications`:

- `classification` es `taxed`, `exempt` o `non_taxed`;
- `vat_code` es obligatorio si está gravado;
- `source` es `accountant` u `owner_confirmed`.

Sin clasificación, el resultado es `MISSING_TAX_CLASSIFICATION`: nunca 0 % ni 21 % "por las dudas".

## 4. Una sola evaluación, con razones estructuradas

`private.commercial_order_fiscal_evaluation(business, order, build_snapshot)` es la única que
decide. La usan el Panel, el celular, WhatsApp y las automatizaciones; la UI solo la muestra.

| Código | Cuándo | Texto del Panel |
|---|---|---|
| `QA_ORDER_NOT_BILLABLE` | pedido QA, `qa_no_charge`, o un producto `test_only`/`staging_only` por cualquier referencia | Pedido de prueba: no se factura |
| `ORDER_CANCELLED` | cancelado o rechazado | Pedido cancelado: no se factura |
| `FISCAL_PROFILE_DISABLED` | sin perfil, apagado o sin ambiente | La facturación está desactivada |
| `HOMOLOGATION_NOT_AUTHORIZED` | homologación sin autorizar | Falta autorizar la homologación con ARCA |
| `PRODUCTION_BLOCKED` | producción sin sus compuertas aprobadas | La facturación real todavía no está habilitada |
| `ACCOUNTING_POLICY_REQUIRED` (`scope` fiscal/commercial) | falta la política del core o la comercial | Configuración fiscal pendiente |
| `ORDER_NOT_BILLABLE_YET` (`billing_moment`) | todavía no es el momento | Se factura cuando el pago esté confirmado / cuando se entregue / cuando se acepte |
| `PAYMENT_REQUIRED` (`payment_state`) | el pago no está como exige la política | Falta confirmar el pago / El pago fue devuelto / El cobro fue revertido |
| `PAYMENT_METHOD_NOT_INVOICEABLE` | la política no factura ese medio | La configuración fiscal no factura este medio de pago |
| `INVALID_TOTAL` (`detail`) | importes con más de 2 decimales, cantidades con más de 3, ítems que no suman el subtotal, moneda distinta de ARS | Los importes del pedido no se pueden facturar exactos |
| `INVALID_PRODUCT_REFERENCE` (`item`) | un ítem que no se puede atar a un producto del negocio | Hay un producto que no se puede identificar: … |
| `MISSING_TAX_CLASSIFICATION` (`item`) | producto sin clasificación | Falta la clasificación impositiva de un producto: … |
| `DISCOUNT_NOT_INVOICEABLE` | hay descuento y la política no lo factura | La configuración fiscal no factura descuentos |
| `DELIVERY_NOT_INVOICEABLE` | hay envío y la política no lo factura | La configuración fiscal no factura el envío |
| `FISCAL_PARAMETERS_REQUIRED` (`vat_code`) | una alícuota fuera de la tabla vigente de ARCA (`vat_types`) | Faltan las tablas actualizadas de ARCA |
| `RECIPIENT_DATA_REQUIRED` (`threshold`) | el total llega al umbral de identificación | Por el monto, hay que identificar al consumidor |

`RECIPIENT_DATA_REQUIRED` falla cerrado a propósito: La Taba todavía no captura los datos del
consumidor final. Un pedido que llega al umbral no se factura hasta que exista esa captura.

## 5. El origen congelado

Con la política aprobada:

- **Precios con IVA incluido, por alícuota.** El bruto de cada grupo de alícuota se separa una
  sola vez (`neto = round(G / (1 + tasa))`, en centavos). Neto e IVA se reparten a las líneas
  por resto mayor (`private.allocate_cents`). Así el total cierra al centavo y el core
  totaliza AlicIva por Id (ARCA 10022/10051; core #2).
- **Descuento.** Se prorratea por el bruto de cada ítem, al centavo, o bloquea si la política
  no lo factura.
- **Envío.** Es una línea con su alícuota, o se excluye con motivo, o bloquea.
- **Cantidades fraccionadas.** Hasta 3 decimales (0,5 kg), con `trim_scale`.
- **Referencias de producto.**
  - `product_uuid` si existe.
  - Si no, `order_items.product_id` (texto histórico). Se prueba como uuid **solo si tiene
    forma de uuid**; si no, se busca por `external_id` o `sku` únicos del negocio.
  - Si la referencia es ambigua o ajena, el resultado es `INVALID_PRODUCT_REFERENCE`. Nunca
    un `::uuid` sin probar.
- **Totales.** Si algo no cierra exacto, falla cerrado. El core valida todo de nuevo al congelar.

El snapshot guarda las líneas, los totales, la política usada (versión) y las referencias
(`product_id`, `order_item_id`). Es inmutable en el core.

## 6. Pagos, actores y canales reales

- **Pago** (`private.order_payment_state`):
  - efectivo y coordinar: `orders.manual_payment_status` (`confirmed`/`reversed`/pendiente);
  - Mercado Pago: `payment_intents` (aprobado, o devuelto/contracargo);
  - no se inventa ningún pago.
- **Actor.** Desde el Panel y el celular es `auth.uid()` (`operator`). Por WhatsApp o
  automatización, `service_request_order_invoice` exige el JWT `service_role`, el canal
  `WHATSAPP`/`AUTOMATION` y, para WhatsApp, un actor que sea miembro activo (owner/admin/staff)
  del negocio.
- **Canal (`command_source`).** Es solo auditoría. Todos los canales convergen por la intención
  del core: 10, 50 y 100 pedidos simultáneos por los cuatro canales producen 1 comprobante,
  1 origen congelado y 1 pedido de impresión.

## 7. El Panel

Cada tarjeta de la bandeja tiene un bloque fiscal (`renderOrderFiscalBlock`):

- **Estado real.** Se lee con `get_order_fiscal_states` al entrar, cada 15 s, cuando un pedido
  aparece o cambia su revisión, y después de cada acción. Recargar muestra lo mismo: nada vive
  solo en el cliente.
- **Botones.** "Facturar" y "Facturar e imprimir" solo aparecen habilitados si el servidor dice
  READY. Sin política: "Configuración fiscal pendiente". Sin estado leído: solo el aviso.
- **Estados del comprobante.** Pendiente, Emitiendo…, Verificando con ARCA…, Factura emitida,
  Requiere revisión, Rechazada. Un "autorizado" sin CAE de 14 dígitos se muestra como
  "Requiere revisión".
- **Homologación.** Se marca siempre: "HOMOLOGACIÓN · sin validez fiscal" y "CAE de homologación".
- **Impresión.**
  - "Se imprime al emitirse" antes de la autorización.
  - "Impresión pendiente", con motivo si la PC está sin conexión o no hay PC vinculada
    (`get_local_print_status`).
  - Imprimiendo…, Impreso y "La impresión falló".
- **Errores.** Cada texto sale de un código conocido. El mensaje del servidor no se muestra
  nunca (SQL, PGRST, SOAP, inglés).
- **Ver PDF.** Pide el acceso con el id del **artefacto** vigente, no del comprobante.

## 8. Facturar e imprimir, reimprimir

- **Facturar e imprimir.**
  - Registra un pedido de impresión **durable** (`fiscal_print_requests`, uno por comprobante,
    con actor y canal).
  - Al autorizarse el comprobante, el trigger lo cumple con la cola real del agente
    (`print_enqueue`) y la misma clave que la impresión automática
    (`auto:fiscal_receipt:<doc>`): un solo primer ticket.
  - Si imprimir falla, no frena la autorización: queda `last_error` y el Panel ofrece imprimir.
- **Reimprimir.** Usa `request_print_job_reprint` sobre el último trabajo terminado. Crea un
  trabajo nuevo con `reprint_of`, actor y motivo, y no pide otro CAE.
- **Impresión física.** NOT_VERIFIED. El agente es simulado en todas las pruebas.

## 9. Pruebas y evidencia

Todas las corridas locales usan PostgreSQL 17 con un shim de Supabase (auth, roles y claims).
No son un stack Supabase completo: se reportan como **PG17+shim**.

| Suite | Qué fija | Resultado |
|---|---|---|
| `supabase/tests/commercial_order_fiscal_test.sql` (pgTAP, 54) | evaluación, razones, origen congelado (envío, 0,5 kg legado, descuento, exento, uuid/legado/SKU), actor y canal, aislamiento, impresión durable, agente real, reimpresión | PASS |
| `scripts/run-release-v5-db.mjs` (cadena canónica, 689 aserciones) | todo el pgTAP de La Taba, con el contrato de #112 (una sola ruta de emisión) | PASS (PG17+shim, superusuario) |
| `scripts/fiscal-core/order-intent-race.mjs` | 10/50/100 pedidos simultáneos por PANEL/MOBILE/WHATSAPP/AUTOMATION | PASS: 1 comprobante, 1 origen, 1 pedido de impresión, 0 ventas POS |
| `scripts/fiscal-core/verify-canonical-worker.mjs` G/H | pedido → worker canónico → FakeArca estricto (AlicIva totalizado) → PDF → ticket del agente → reimpresión; respuesta perdida → conciliación sin reenvío | PASS |
| `tests/e2e/order-fiscal-real-db.spec.mjs` (Playwright, local) | la bandeja contra la base real: botones desde el servidor, RPC real con uuid/canal/clave, recarga, ya facturado no se repite, fail closed al cambiar el pago, PC sin conexión, impresión, reimpresión, errores sin jerga, teléfono 390×844 | PASS 3/3 (chromium; escritorio y teléfono emulado) |
| `tests/e2e/order-fiscal-panel.spec.mjs` (Playwright, CI) | cableado de la bandeja con datos de prueba | PASS |
| `tests/order-fiscal-presenter.test.mjs` | textos, botones, homologación, impresión, errores | PASS 8/8 |

La E2E con la base real encontró dos defectos que las pruebas unitarias no veían:

- la bandeja llamaba las RPC fiscales en el repositorio de pedidos, que no las tiene;
- un mensaje PGRST202 sin la palabra "PGRST" llegaba al aviso.

Los dos están corregidos y fijados.

Cómo reproducir (base local descartable, nunca producción):

```sh
# base recién migrada con la cadena de La Taba (PG17 local)
TABA_E2E_FISCAL_DB=postgres://postgres@127.0.0.1:55461/<base> \
TABA_FISCAL_DIR=<taba-fiscal en 9fd32fd, compilado> \
  npx playwright test tests/e2e/order-fiscal-real-db.spec.mjs --project=chromium

TABA_LOCAL_FISCAL_DB=1 TABA_FISCAL_DIR=<idem> npm run fiscal:core:verify -- postgres://postgres@127.0.0.1:55461/<otra-base>
```

## 10. Lo que falta y decide una persona

HUMAN_ACTION_REQUIRED. Nada de esto se inventa en código:

1. **Política comercial de La Taba**, aprobada por su contador: momento de facturación, reglas
   por medio de pago, envío, descuentos, umbral de identificación y referencia.
2. **Clasificación impositiva de cada producto vendible**: gravado y alícuota, exento o no gravado.
3. **Datos fiscales reales**: CUIT, condición frente al IVA, punto de venta habilitado para web
   services, certificado. La Taba no los tiene y no se inventan.
4. **Homologación real con ARCA**, con el certificado de homologación del comercio.
5. **Impresora física**: la prueba con el agente real en la PC del mostrador.
6. **Merge** de #112, de esta rama y de los PR del core (#1, #2, #3), en ese orden.

Preguntas para Walter o su contador:

- ¿Cuándo se factura un pedido online: al confirmar el pago, al entregarlo o al aceptarlo?
- Efectivo contra entrega y "coordinar": ¿se factura con el cobro confirmado o también pendiente?
- Mercado Pago: ¿solo aprobado?
- El envío: ¿se factura como una línea? ¿Con qué alícuota? ¿O se excluye?
- Descuentos: ¿se prorratean por el bruto de cada ítem, o no se facturan pedidos con descuento?
- ¿Qué alícuota lleva cada producto: bebidas, alimentos, hielo, otros?
- ¿Desde qué importe hay que identificar al consumidor final, según la norma vigente que aplique su contador?
- Devoluciones y cancelaciones después de facturar: ¿nota de crédito siempre con revisión
  manual? Hoy es `manual_review_only`: no hay nota de crédito automática.
- ¿Qué tipo de comprobante corresponde (B a consumidor final si es Responsable Inscripto; C si
  es monotributista)? Lo fija el perfil fiscal real.
