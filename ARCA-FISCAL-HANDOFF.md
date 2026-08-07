# ARCA-FISCAL-HANDOFF — facturación electrónica de TABA2

Fecha: 2026-08-07 · Worktree: `la-taba2-arca-fiscal-automation` ·
Rama: `feature/taba2-arca-fiscal-automation` · Base: `c7c3bbd`

| | |
| --- | --- |
| Commits (locales, sin push) | `6c038fa` contrato de base · `353ffed` puente ARCA · `6062d16` proyección de estados y Panel |
| Alcance | 37 archivos, +3894/−140 |
| Lock de staging | `taba2-staging-mutation.lock` estaba **ocupado** (OWNER=TABA2_PILOT_RC, HOLDING). No se tocó, no se borró, no se completó. **Todo el trabajo es local.** |
| Staging / producción / ARCA real | **Intactos.** Ninguna migración aplicada a staging, ninguna Edge Function desplegada, ningún comprobante emitido en ningún ambiente. |
| Ambiente ARCA usado | Ninguno todavía: falta el certificado (ver §8). Producción sigue bloqueada por triple defensa. |

---

## 1. Veredicto

**Antes:** área 17 del Panel, "Facturación ARCA", clasificada PARCIAL / **NO
OPERATIVA**. Tres cortes de contrato independientes, cada uno suficiente para
que no se emitiera nunca nada, ni siquiera simulado.

**Ahora:** el circuito completo existe, está cableado de punta a punta y está
probado contra una base real y contra una ARCA simulada que reproduce los
fallos que homologación no deja provocar a voluntad. Los cuatro cortes —los
tres del informe más uno que ese informe no había encontrado— están cerrados.

**Lo que todavía no está:** la certificación contra la HOMOLOGACIÓN oficial de
ARCA. No es un pendiente de software: **falta el certificado X.509**, y
obtenerlo exige una persona con Clave Fiscal frente a WSASS. Todo lo que
depende de ese certificado está listo y esperando; nada de eso se declara
certificado hasta que corra contra los endpoints reales. Ver §8 y §11.

---

## 2. Los cuatro cortes

Los tres primeros son los de `BUSINESS-PANEL-HARDENING.md` §4. El cuarto no
figura ahí y era igual de terminal.

### Corte 1 — toda venta del mostrador rompía en el primer ítem

`checkout_pos_sale` escribía `tax_snapshot = {"configured_by_server": true}`
(M160:717) y `request_fiscal_document` exige las cinco claves de importes
(M170:751). Ninguna venta POS podía convertirse en comprobante.

**Cerrado:** `checkout_pos_sale` desagrega neto e IVA con la alícuota declarada
en la política contable aprobada. Con IVA incluido en el precio,
`neto = round(bruto / (1 + tasa/100), 2)` e `iva = bruto − neto`: la suma cierra
al centavo contra lo cobrado, siempre, porque el IVA se calcula por diferencia y
no por redondeo independiente. **Sin política aprobada la venta se cobra igual**
—el mostrador no se cae porque falte facturación— y el snapshot dice
literalmente `{"fiscal_pricing":"unavailable"}` en vez de fingir un precio
fiscal que no existe.

### Corte 2 — no había forma de crear ni aprobar una política contable

Sin política, `request_fiscal_document` lanzaba siempre (M170:740-746). No
existía RPC, ni UI, ni seed: la tabla `fiscal_accounting_policies` nunca había
tenido una fila y no había manera de que la tuviera.

**Cerrado:** `upsert_fiscal_accounting_policy`, `approve_fiscal_accounting_policy`,
`revoke_fiscal_accounting_policy` y `list_fiscal_accounting_policies`. Declarar
una política **no** la habilita; aprobarla exige owner/admin más la frase exacta
`I_APPROVE_THIS_FISCAL_ACCOUNTING_POLICY`, y queda registrado quién y cuándo.
Tocar una política aprobada la devuelve a `pending`: cambiar un dato fiscal
obliga a que alguien lo vuelva a aprobar.

### Corte 3 — el botón de homologación no podía habilitarse nunca

Nadie llamaba a `record_fiscal_credential_health`; el puente sólo imprimía a
stdout. `certificate_fingerprint_sha256` quedaba NULL y
`authorize_arca_homologation` fallaba siempre en M5120:143.

**Cerrado:** el puente publica huella SHA-256, vencimiento y CUIT del
certificado al arrancar y tras cada verificación de conexión, y marca la
delegación como verificada sólo después de un `FEDummy` exitoso. La clave
privada y el PEM no salen del proceso.

### Corte 4 — encontrado en esta intervención, no registrado antes

`authorize_arca_homologation` exige `fiscal_profiles.accountant_review_status =
'approved'` (M4090:134). **Ninguna función, UI, seed ni migración del
repositorio podía escribir ese valor.** Con certificado cargado, parámetros
sincronizados y política aprobada, el botón seguía siendo inalcanzable.

**Cerrado:** `record_fiscal_accountant_review(business, decision, frase, notas)`,
owner/admin, frase exacta `I_CONFIRM_THE_FISCAL_DATA_WERE_REVIEWED`, con actor y
fecha. La revisión contable es una decisión de una persona, no un efecto
colateral de guardar un formulario.

---

## 3. Defectos encontrados contra el contrato real de ARCA

Estos no estaban en ningún informe. Aparecieron al contrastar el código con el
WSDL vigente y el Manual del Desarrollador de WSAA (Publicación 20.2.19).

| # | Defecto | Por qué importa |
| --- | --- | --- |
| D1 | `FECAESolicitar` enviaba **`ImpIVA` antes que `ImpTrib`** | El WSDL vigente declara `ImpOpEx, ImpTrib, ImpIVA` dentro de un `xsd:sequence`. Un `.asmx` lee la secuencia **en orden** y descarta lo que llega fuera de lugar: ARCA recibía ceros donde iban los importes y habría rechazado por inconsistencia de totales. Un comprobante jamás habría sido autorizado. |
| D2 | Faltaba **`CondicionIVAReceptorId`** | Está publicado en el WSDL vigente (`FEParamGetCondicionIvaReceptor` existe como tabla oficial). Ahora viaja desde la política aprobada, en su posición exacta: después de `MonCotiz`, antes de `CbtesAsoc`. |
| D3 | Los **SOAP Fault viajan con HTTP 500** y el transporte los descartaba como "ARCA caída" | Reintentaba a ciegas fallas permanentes (certificado inválido, ambiente equivocado) y ocultaba el único mensaje con el que WSAA avisa que el TA anterior sigue vigente. |
| D4 | El **Ticket de Acceso vivía sólo en memoria** | WSAA retiene el TA vigente y rechaza pedidos repetidos dentro de una ventana de retención: **10 minutos en homologación, 2 en producción**, "modificables dinámicamente y sin aviso previo" según el manual. Reiniciar el worker lo dejaba bloqueado hasta que esa ventana venciera. |
| D5 | Un comprobante **ya autorizado dejaba la cola girando** | `worker.ts` hacía `return` sin cerrar el lease: vencía, otro worker reclamaba el mismo trabajo terminado, volvía a soltarlo. Bucle infinito sobre un documento resuelto. |
| D6 | Sólo el **timeout** se consideraba ambiguo | Un 502 del borde o una conexión cortada después de enviar un `FECAESolicitar` dejan exactamente la misma duda. Reenviar a ciegas es la única forma de emitir dos veces. |
| D7 | El **claim de la outbox era multi-tenant y multi-ambiente** | Un worker de homologación con el certificado de un CUIT podía reclamar comprobantes de otro CUIT o de producción. |
| D8 | El TRA se emitía en **UTC con `Z`** | El manual documenta el formato con desplazamiento de Argentina y advierte que el equipo debe estar en GMT-3. Se emite `-03:00`, y un reloj corrido frente a ARCA ahora falla cerrado en vez de producir rechazos inexplicables. |

Todos corregidos, todos con prueba de regresión.

---

## 4. El circuito, tal como quedó

```
pedido pagado  /  venta de mostrador cobrada
   └─ disparador idempotente (nunca puede voltear la venta ni el pedido)
        └─ fiscal_emission_intents        ← unique(negocio, origen, id, intención)
             └─ promote_fiscal_emission_intents  (worker, con lease y backoff)
                  └─ política contable aprobada + tablas oficiales frescas
                       └─ fiscal_documents 'queued' + fiscal_outbox
                            └─ WSAA homologación (TA persistente, ±reloj)
                                 └─ FECompUltimoAutorizado
                                      └─ reserva local del número (advisory lock + unique)
                                           └─ FECAESolicitar
                                                ├─ CAE  → 'authorized' → PDF + QR
                                                ├─ R    → 'rejected'
                                                └─ falla → FECompConsultar → CAE o reintento
```

**Cero doble emisión, con dos defensas independientes:** unicidad de la
intención por origen, y unicidad del comprobante por
`(negocio, origen, id, intención)`. Una tercera clave de idempotencia distinta
sobre el mismo origen devuelve el comprobante que ya existe.

**Estados del sistema:** `pending` · `processing` · `authorized` · `rejected` ·
`retry` · `manual_review`. Se agregó `manual_review` a `fiscal_documents`: un
problema de configuración ya no se disfraza de `failed` genérico.

**La venta sale de `completed_fiscal_pending`** cuando el comprobante se
resuelve —autorizado o no—. Cobrada es cobrada; el problema fiscal vive en el
comprobante, que es donde el Panel lo muestra.

---

## 5. La UI dice exactamente cinco cosas

`pendiente` · `procesando` · `autorizado` · `rechazado` · `requiere atención`.

Antes el chip de cada comprobante mostraba el estado crudo del backend
(`authorizing`, `retry_wait`, `ambiguous`). La proyección canónica está escrita
**dos veces a propósito** —`public.fiscal_public_state` y
`js/core/fiscal-domain.js`— y un test compara rama por rama las dos
implementaciones sobre los trece estados reales: servidor y pantalla no pueden
divergir en silencio.

**Nunca "emitido" sin CAE.** Un `authorized` sin CAE de catorce dígitos se
muestra como *requiere atención*, no como éxito, en las dos implementaciones. Un
test recorre todas las etiquetas y todos los detalles buscando las palabras
"emitido" y "factura autorizada": no aparecen en ninguna. El mostrador usa la
misma proyección en vez de su frase propia, que llamaba "comprobante pendiente"
a un rechazo.

El asistente fiscal ganó el paso que faltaba —**política contable aprobada**— y
distingue `readyToHomologate` de `readyToEmit`: autorizar homologación nunca
alcanzó para emitir.

---

## 6. Ninguna decisión fiscal se infiere

Condición frente al IVA del receptor, alícuota, si el IVA se discrimina, si los
precios ya lo incluyen, tipo de comprobante, tipo de nota de crédito, tipo y
número de documento del receptor, concepto, punto de venta y **tratamiento del
envío**: todos se declaran en la política contable. Ninguno tiene valor por
omisión en el código.

Cada identificador declarado se valida **contra la tabla oficial que el puente
bajó de ARCA**, con snapshot de menos de siete días, en dos momentos: al aprobar
la política y en cada uso. Es la diferencia entre "el contador escribió 6" y
"ARCA reconoce el 6".

Si algo no está declarado, el circuito **se detiene y pide revisión**. Un pedido
con envío y sin tratamiento del envío declarado no se factura "con la misma
alícuota, total da igual": va a `manual_review`.

La herramienta de certificación se niega explícitamente a completar un caso
fiscal incompleto y nombra los campos que faltan.

---

## 7. Gates y evidencia

| Gate | Resultado |
| --- | --- |
| `npm test` | **1111/1111** (base 1102; +8 de la suite de estados fiscales, +1 del asistente) |
| `npm run fiscal:test` | **43/43** (base 17) |
| `npm run fiscal:db:local` | **162 aserciones** sobre una PostgreSQL **vacía**: 57 migraciones aplicadas desde cero + 91 + 41 + 30 |
| `npm run migrations:validate` | aprobado |
| `npm run check` | pasa |
| `npm run secrets:scan` | limpio |
| `npm run test:e2e` | ver §12 |
| Certificación en homologación oficial | **PENDIENTE — falta el certificado (§8)** |

`npm run fiscal:db:local` levanta su propio contenedor, aplica las 57
migraciones sobre una base vacía y corre las tres suites pgTAP fiscales. Es
reproducible sin staging y sin ARCA.

**Escenarios probados** (pgTAP contra base real + ARCA simulada):
TA vigente / por vencer / vencido · retención de WSAA con y sin ticket guardado ·
reloj corrido · CAE aprobado · CAE rechazado · **timeout después de que ARCA
autorizó** · caída de ARCA (503) · consulta posterior que encuentra el
comprobante · reintento con backoff · dos workers en paralelo · doble click ·
montos y prorrateo de descuento al centavo · numeración correlativa · CAE de 13
y de 15 dígitos rechazados · inmutabilidad post-CAE · permisos (`authenticated`
no puede reclamar la outbox, correr el promotor ni saltear la puerta de
autorización) · y auditoría sin token, sign ni PEM.

---

## 8. HUMAN_CHECKPOINT_ARCA_1

> **Acción concreta:** entrar a **WSASS** con Clave Fiscal y obtener el
> certificado X.509 de **homologación** para el CUIT de La Taba, asociado al
> servicio **`wsfe`**.

El pedido de certificado ya está automatizado para que no haya que pelear con
OpenSSL ni equivocar el formato del `serialNumber`:

```powershell
npm run fiscal:csr -- --cuit <11 dígitos> --organization "<razón social>" `
  --system taba-fiscal-homologacion --out <ruta absoluta FUERA del repositorio>
```

Genera la clave privada (RSA 2048, permisos 600) y el `.csr` con el subject
exacto que documenta el manual de WSASS:
`/C=AR/O=<empresa>/CN=<sistema>/serialNumber=CUIT <11 dígitos>`. La herramienta
**se niega** a escribir dentro del repositorio y **se niega** a pisar una clave
existente. La clave privada nunca se imprime.

Sólo se necesita a una persona para: login con Clave Fiscal (MFA/reCAPTCHA),
habilitar WSASS, pegar el `.csr`, descargar el certificado y autorizarlo al
servicio `wsfe`. Nada de eso se automatiza y nada de eso se intentó.

Con el certificado en mano, lo que sigue no requiere intervención:

```powershell
# 1. Montar los secretos fuera del repositorio y verificar el par
npm --prefix services/arca-fiscal-bridge run credentials:check

# 2. Lectura pura contra homologación oficial: FEDummy, tablas, último autorizado
npm run fiscal:certify:homologation -- --case <caso.json> --out <evidencia.json>

# 3. Emisión real de homologación + consulta por número
npm run fiscal:certify:homologation -- --case <caso.json> --emit --out <evidencia.json>
```

`docs/arca/homologation-case.example.json` es la plantilla del caso fiscal. Sus
números son ceros a propósito: los completa el titular o su contador. La
evidencia que se escribe está saneada (permisos 600) y nunca contiene token,
sign, PEM ni XML crudo.

**HUMAN_CHECKPOINT_ARCA_2** quedará abierto después: las decisiones fiscales del
caso de homologación (tipo de comprobante, condición frente al IVA del receptor,
alícuota, punto de venta). No se piden ahora porque sin certificado no se pueden
validar contra las tablas oficiales de ARCA, que es justamente lo que impide
inventarlas.

---

## 9. Seguridad

- Clave privada y certificado se montan como **rutas absolutas fuera del
  repositorio**; `ARCA_CERTIFICATE_PATH` y `ARCA_PRIVATE_KEY_PATH` rechazan
  cualquier valor que parezca un PEM o que no sea absoluto.
- El **Ticket de Acceso** ahora persiste, y por eso se trata como el secreto que
  es: archivo con permisos 600, escritura atómica (temporal + rename), fuera del
  repositorio, con su propia variable `ARCA_TICKET_STATE_PATH`. Un archivo
  ilegible se trata como "sin ticket", no tumba el worker.
- `record_fiscal_credential_health` es **service_role únicamente**; el navegador
  no puede escribir salud de credenciales. `claim_fiscal_outbox`,
  `promote_fiscal_emission_intents`, `release_fiscal_outbox_lease`,
  `settle_completed_fiscal_outbox` e `internal_create_fiscal_document` están
  revocadas para `authenticated` y hay prueba de que lo están.
- La tabla `fiscal_accounting_policies` **no es legible directamente ni por el
  owner**: el Panel la ve por RPC.
- El logger del worker filtra por nombre de campo `token|sign|secret|password|
  certificate|private key|service role|recipient`, y hay un test que le pasa un
  token con marca y verifica que no aparezca en la auditoría.
- `secrets:scan` limpio. `.gitignore` del puente cubre `.env`, certificados y
  claves.
- Producción sigue bloqueada por triple defensa: variable de entorno con frase
  propia, `production_gate_status` en la base y el trigger
  `assert_fiscal_execution_authorized`. La política de producción **no se puede
  declarar ni aprobar desde el Panel**.

---

## 10. Hallazgo fuera de alcance, reportado sin tocar

`supabase/migrations/20260806160000_order_qa_origin_classification.sql` **no se
puede aplicar sobre una base vacía**: hace `create or replace function
public.get_rider_queue(uuid)` cambiando sus columnas `OUT`, cosa que PostgreSQL
rechaza (`cannot change return type of existing function`). En staging ya está
aplicada, así que nadie lo notó; pero **ningún entorno nuevo se puede construir
desde estas migraciones**.

Es ajeno a lo fiscal y pertenece a otra línea de trabajo, así que **no se tocó
la migración histórica**. El harness local lo sortea con un
`drop function if exists` explícito y comentado
(`scripts/run-arca-fiscal-local-db.mjs`). El arreglo real es una línea:

```sql
drop function if exists public.get_rider_queue(uuid);
```

inmediatamente antes del `create or replace` de esa migración.

Dos suites pgTAP preexistentes tampoco corren hoy sobre una base limpia por
motivos igualmente ajenos: `durable_offline_packing_test` inserta pedidos sin
`payment_method`, que `20260806170000` volvió `NOT NULL`.

---

## 11. Reservas explícitas

1. **La certificación en homologación oficial NO está hecha.** Falta el
   certificado. Todo lo que la habilita está construido y probado; nada de eso
   la reemplaza. Los mocks no bastan y no se presentan como si bastaran.
2. **La política contable de ejemplo no es una decisión fiscal.** Los valores de
   `docs/arca/homologation-case.example.json` y del fixture pgTAP son sintéticos
   y están marcados como tales.
3. **Nada se aplicó a staging.** El lock estaba ocupado. Las dos migraciones
   nuevas (`20260807110000`, `20260807120000`) están validadas estáticamente y
   aplicadas sobre una base local desde cero, pero **no** contra
   `la-taba-staging`.
4. **La cotización queda en 1 y la moneda en PES.** Moneda extranjera exige
   `FEParamGetCotizacion` y una decisión contable que nadie tomó: el circuito no
   la ofrece en vez de aproximarla.
5. **`FECAEASolicitar`, exportación, `wsmtxca` y regímenes especiales siguen
   fuera de alcance**, igual que antes.
6. **Las notas de crédito automáticas siguen siendo manuales**: existen las RPC y
   están probadas, pero ningún disparador las emite solo.
7. **El puente no está desplegado.** Corre local. Su despliegue en red privada
   es una tarea de infraestructura documentada en `docs/arca/README.md`.

---

## 12. Declaración

El circuito fiscal de TABA2 quedó implementado de punta a punta, con los cuatro
cortes de contrato cerrados, ocho defectos contra el contrato real de ARCA
corregidos, cero decisiones fiscales inferidas, dos defensas independientes
contra la doble emisión, y una UI que dice exactamente cinco cosas y nunca
promete un CAE que no existe.

**La declaración `TABA2_ARCA_HOMOLOGATION_FISCAL_FLOW_CERTIFIED` NO se emite
todavía**, y no se va a emitir contra mocks. Requiere una corrida contra los
endpoints oficiales de homologación —`wsaahomo.afip.gov.ar` y
`wswhomo.afip.gov.ar`— con un certificado real. Ese es el único paso que falta,
está bloqueado en **HUMAN_CHECKPOINT_ARCA_1**, y el comando que produce su
evidencia ya está escrito y probado.

Declarar certificado un circuito que nunca habló con ARCA sería exactamente la
clase de mentira que este trabajo vino a eliminar.

**TABA2_ARCA_FISCAL_FLOW_IMPLEMENTED_AND_LOCALLY_CERTIFIED — HOMOLOGACIÓN
OFICIAL PENDIENTE DE CERTIFICADO**
