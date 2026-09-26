# Facturación ARCA · diseño verificado (septiembre 2026)

Complementa [`README.md`](README.md) y [`credit-notes-and-homologation.md`](credit-notes-and-homologation.md),
que describen el worker `services/arca-fiscal-bridge` y el esquema fiscal. Este
documento re-verifica ese diseño contra la documentación oficial **vigente** y
fija las decisiones que faltaban (dónde corre, estados, reembolsos, homologación).

## Fuentes oficiales consultadas (2026-09-26)

| Fuente | Versión | Lo que se tomó |
|---|---|---|
| Especificación técnica WSAA (`/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf`) | 1.2.2 | TRA, firma CMS, TA, tiempos, códigos de error, requisitos del certificado |
| Página WSAA (`arca.gob.ar/ws/documentacion/wsaa.asp`) | — | Endpoints de homologación y producción, WSASS para certificados de prueba |
| Manual del desarrollador WSFEv1, RG 4291 (`/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf`) | **4.7, revisión del 1 de septiembre de 2026** | Métodos, endpoints, validaciones, operatoria ante errores de comunicación |

El README anterior citaba el manual 4.5. Entre la 4.0 y la 4.7 cambiaron cosas
que afectan al worker (ver «Brechas»).

## WSAA

- **TRA** (`loginTicketRequest`): `uniqueId` (entero sin signo de 32 bits),
  `generationTime`, `expirationTime`, `service` (`wsfe`). ARCA acepta un
  `generationTime` de hasta 24 h antes y un `expirationTime` de hasta 24 h
  después (errores `xml.generationTime.invalid`, `xml.expirationTime.invalid`).
- **Firma**: CMS/PKCS#7 *SignedData* que contiene el TRA, la firma y el
  certificado X.509; se codifica en Base64 y se envía a `LoginCms`.
- **TA** (`loginTicketResponse`): `token`, `sign`, `generationTime`,
  `expirationTime`. **Vale 12 horas** y hay que reutilizarlo mientras sea
  válido: pedir otro devuelve `coe.alreadyAuthenticated`.
- **Reintentos**: ante errores que no sean `wsaa.*` o `wsn.unavailable` no se
  piden TA nuevos hasta resolver la causa (autorización, reloj, desarrollo); en
  el resto, no volver a pedir durante 60 segundos.
- **Endpoints**: homologación `https://wsaahomo.afip.gov.ar/ws/services/LoginCms`;
  producción `https://wsaa.afip.gov.ar/ws/services/LoginCms`. Siempre HTTPS
  validando el certificado TLS del servicio.
- **Diseño**: un TA en caché por ambiente + CUIT + servicio, renovado con margen
  y compartido entre renovaciones concurrentes (ya implementado en el worker).
  `token` y `sign` no se registran nunca.

## Certificados y custodia

- El certificado del sistema (CEE) tiene `serialNumber = "CUIT <n>"`, `CN` con el
  nombre de la aplicación, `O` y `C` (requisitos de la especificación WSAA).
- Homologación: certificado emitido por **WSASS** con clave fiscal. Producción:
  **Administración de Certificados Digitales**. Credenciales y certificados
  separados por ambiente; nunca se comparten.
- Cada comercio **delega** el servicio de facturación electrónica a la CUIT del
  sistema en el *Administrador de Relaciones de Clave Fiscal*. Así un solo
  certificado actúa por muchos comercios y ninguna clave privada viaja a un local.
- Custodia server-side (recomendada): archivo montado desde el secret manager,
  permisos mínimos, alerta de vencimiento a 30 días (`credentials:check`).
- Custodia local (sólo si un comercio la exige): Windows Certificate Store con
  clave **no exportable** y configuración protegida con DPAPI, dentro del agente
  local. Diseñada en el spike .NET; no habilitada.
- Nunca: repositorio, `localStorage`, JSON plano, instalador, logs.

## WSFEv1

Endpoints: homologación `https://wswhomo.afip.gov.ar/wsfev1/service.asmx`;
producción `https://servicios1.afip.gov.ar/wsfev1/service.asmx`.

Métodos que usa el circuito CAE (RG 4291): `FECAESolicitar`,
`FECompUltimoAutorizado`, `FECompConsultar`, `FEDummy` y los recuperadores de
parámetros (`FEParamGetTiposCbte`, `FEParamGetTiposDoc`, `FEParamGetTiposIva`,
`FEParamGetTiposMonedas`, `FEParamGetTiposConcepto`, `FEParamGetPtosVenta`,
`FEParamGetCondicionIvaReceptor`, `FEParamGetCotizacion`).

Reglas que el sistema no puede inferir y salen de configuración aprobada por el
contador (`fiscal_accounting_policies`, por comercio y ambiente):

- **Clase de comprobante** (A, B, C, M) según la condición del emisor y del
  receptor. Los códigos se validan contra `FEParamGetTiposCbte`; no se usa el cero
  ni una heurística.
- **Concepto**: 1 Productos, 2 Servicios, 3 Productos y Servicios. Con concepto 1
  la fecha del comprobante puede estar hasta 5 días antes o después del envío,
  sin salir del mes, y **no puede ser anterior** a la del último comprobante de
  ese tipo y punto de venta.
- **Receptor**: en B y C, por debajo del monto de la RG 4444 se admite
  `DocTipo 99` con `DocNro 0`; desde ese monto hay que identificarlo. El monto
  cambia por resolución: se configura, no se escribe en el código.
- **Condición frente al IVA del receptor** (`CondicionIVAReceptorId`, manual 4.0,
  RG 5616): se valida contra `FEParamGetCondicionIvaReceptor`; el código de
  rechazo 10246 la declara obligatoria.
- **CUIT receptora inactiva o inválida** (validación 10247, manual 4.2):
  excluyente salvo en notas de crédito.
- Redondeo: *round half even*, como declara el manual.
- CAEA: desde la versión 4.6 (RG 5782) los puntos de venta CAEA son de
  contingencia. Este sistema usa CAE.

## Brechas del worker actual contra el manual 4.7

| Brecha | Efecto | Acción |
|---|---|---|
| No envía `CondicionIVAReceptorId` | Rechazo 10246 cuando rija la obligatoriedad | Agregar el campo al request y a `fiscal_documents` (o a la política), sincronizar `FEParamGetCondicionIvaReceptor` |
| No sincroniza `FEParamGetCondicionIvaReceptor` | No se puede validar la condición antes de enviar | Sumarlo a los snapshots de parámetros |
| Documentación en manual 4.5 | Reglas nuevas sin revisar (10247, CAEA 4.6, 4.7 caución/no categorizado) | Revisar códigos nuevos contra la política contable |

**Estado 2026-09-26 — brechas cerradas en el worker server-side** (rama
`feat/taba-arca-homologation-ready`):

| Brecha | Cierre |
|---|---|
| `CondicionIVAReceptorId` | Migración `20260926170000_fiscal_receiver_vat_condition.sql`: política → comprobante → nota de crédito, validado contra la tabla oficial, inmutable al autorizar; el worker lo envía en el orden del WSDL y no numera sin él. pgTAP `fiscal_receiver_vat_condition_test` (14), pruebas del worker con dobles. |
| `FEParamGetCondicionIvaReceptor` | Séptima tabla sincronizada (`recipient_vat_conditions`). |
| Orden del sobre | `ImpTrib` antes que `ImpIVA`, como `FEDetRequest` del WSDL (el worker los tenía invertidos). |
| Reconciliación | Consulta + último autorizado antes de reenviar el MISMO número; nunca otro número (portado del spike, que ya no tiene frontera fiscal: ARCA es server-side). |
| TA tras reinicio | `ARCA_TA_CACHE_PATH` (0600) y `coe.alreadyAuthenticated` reintentable. |

Verificado contra el WSDL de homologación descargado el 2026-09-26
(`https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL`): `FEDetRequest`
declara `…MonId, MonCotiz, CanMisMonExt, CondicionIVAReceptorId, CbtesAsoc,
Tributos, Iva…` y `FEParamGetCondicionIvaReceptor(Auth, ClaseCmp)` devuelve
`{Id, Desc, Cmp_Clase}`.

## CAE: qué se persiste

Ya existe en `fiscal_documents`: tipo, punto de venta, número, `cae` (14
dígitos, restricción de base), `cae_expiration`, `result`, `observations`,
`errors`, `request_hash`/`response_hash`, `idempotency_key`; y cada intento en
`fiscal_request_attempts` con su `request_id`. Una restricción impide el estado
`authorized` sin CAE válido, número y fecha: **no hay forma de fabricar un CAE**.

## Idempotencia fiscal

1. **Una venta, un comprobante**: `unique(business_id, source_type, source_id,
   document_intent)`. Reintentar la solicitud devuelve el mismo documento.
2. **Una numeración**: `unique(environment, cuit, point_of_sale, document_type,
   document_number)`; el número se reserva con advisory lock antes de ARCA.
3. **Timeout no es fracaso**. Es la regla del manual («Operatoria con errores de
   comunicación»): si ARCA asignó el CAE y se perdió la respuesta, reenviar da
   error de correlatividad. Antes de reintentar se consulta `FECompConsultar`
   con el número reservado (y `FECompUltimoAutorizado`), se compara tipo, punto,
   número, fecha y total, y sólo entonces se decide: recuperar el CAE, reenviar
   o marcar desajuste para revisión humana.
4. Lease con dueño y vencimiento sobre `fiscal_outbox` (`SKIP LOCKED`): dos
   workers no toman el mismo documento; uno caído libera por vencimiento.

## Cola fiscal: estados

| Estado pedido en la misión | Estado en `fiscal_documents` / `fiscal_outbox` | Qué ve el comercio |
|---|---|---|
| PENDING | `draft`, `queued` / `pending`, `retry_wait` | «Comprobante pendiente» |
| PROCESSING | `claiming`, `authenticating`, `authorizing` / `leased` | «Emitiendo…» |
| AUTHORIZED | `authorized`, `observed` (autorizado con observaciones) | «Factura autorizada» + CAE |
| REJECTED | `rejected` | «Rechazado por ARCA» + motivo sanitizado |
| NEEDS_RECONCILIATION | `ambiguous`, y `failed`/`dead_letter` por desajuste | «Requiere revisión» — no se reemite |

Si ARCA está caído, la venta sigue según la política comercial y el documento
queda pendiente, visible como tal. **Nunca se muestra «Facturado» sin CAE**, y
un comprobante pendiente no puede quedar más de 5 días (concepto 1) sin
intervención, porque después ARCA ya no acepta esa fecha.

## Datos fiscales por comercio

`fiscal_profiles` por negocio y ambiente: razón social, CUIT, condición fiscal,
condición predeterminada del receptor, domicilio comercial, punto de venta
(dado de alta para *web services*), revisión contable y compuerta de
producción. El vínculo con el certificado es la delegación verificada de esa
CUIT. Nada de esto está escrito en el código ni atado a un comercio en
particular.

## Factura ↔ pedido

`fiscal_documents.source_type = 'online_order'` y `source_id = <pedido>` (o
`pos_sale`); una nota de crédito apunta a su factura con
`associated_document_id`. La historia es inmutable: `fiscal_events` sólo agrega
filas, una factura autorizada no se borra ni se edita, y una regeneración de PDF
conserva la anterior como reemplazada.

## Reembolso ≠ nota de crédito

Son dos hechos distintos y no se disparan uno al otro solos:

| | Reembolso (Mercado Pago) | Nota de crédito (ARCA) |
|---|---|---|
| Qué mueve | Dinero | La obligación fiscal |
| Quién lo decide | Operación / pagos | Owner/admin con motivo, según política contable |
| Idempotencia | La del proveedor de pagos | `idempotency_key` + asignaciones que no superan lo facturado |

Flujo: si un pedido con factura autorizada se reembolsa, el Panel **propone**
solicitar la nota de crédito (total o parcial, con motivo) y la solicitud pasa
por la misma cola fiscal. Un reembolso fallido no genera nota. Una nota puede
existir sin reembolso (ajuste comercial) si la política lo permite. Esta rama no
toca Mercado Pago.

## Impresión del comprobante

Sólo después del CAE: PDF A4 con QR (especificación QR versión 1 de ARCA) o
ticket de 80 mm con el mismo QR vía ESC/POS desde el agente local. Antes del CAE
sólo existe el «comprobante interno no fiscal». Reimprimir nunca pide otro CAE.

## Homologación

Pasos (el detalle operativo está en el README):

1. Certificado de homologación por WSASS y autorización al servicio `wsfe` (clave fiscal: acción humana).
2. Montar secretos fuera del repo, `credentials:check`, `FEDummy`, sincronizar parámetros incluida la condición del receptor.
3. Casos sintéticos acordados con el contador: factura, nota de crédito asociada, reintento con respuesta perdida (consulta antes de reenviar), duplicado de la misma venta, receptor inválido, rechazo.

**ARCA_HOMOLOGATION: PENDING_CREDENTIALS** — no hay certificado de homologación, CUIT ni punto de
venta de prueba en este entorno. El código está listo (`ARCA_CODE_READY_FOR_HOMOLOGATION: YES`);
el procedimiento está en [`docs/ARCA-HOMOLOGATION-RUNBOOK.md`](../ARCA-HOMOLOGATION-RUNBOOK.md). Las pruebas con dobles (worker Node y spike
.NET) validan contratos, no la homologación.

## Producción

```
HUMAN_ACTION_REQUIRED:
REASON: certificado de producción de ARCA y autorización fiscal del comercio.
ACTION: (1) el contador aprueba la política contable del comercio;
        (2) el comercio delega wsfe a la CUIT del sistema en el Administrador de Relaciones
            y da de alta un punto de venta para web services;
        (3) el responsable emite el certificado de producción y lo carga en el secret manager;
        (4) se habilita la compuerta de producción del servidor con aprobación nominal.
```

**ARCA_PRODUCTION: DISABLED_BY_DESIGN** hasta completar esa lista.
