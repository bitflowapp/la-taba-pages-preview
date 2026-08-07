# ARCA-FISCAL-HANDOFF — facturación electrónica de TABA2

Fecha: 2026-08-07 · Worktree: `la-taba2-arca-fiscal-automation` ·
Rama: `feature/taba2-arca-fiscal-automation` · Base: `c7c3bbd`

| | |
| --- | --- |
| Fase anterior | circuito sintético certificado (`d6995bf`) |
| Esta fase | facturación automática configurable: `18701d9` la puerta única · `eab208f` seis pasos, tablero y bandeja · `6f10c16` E2E del onboarding |
| Fase del circuito sintético | `c418333` rider · `0aa4aab` importes contra ARCA · `4896fb7` marca de ambiente · `ac0368c` reinicio del worker · `c6a8609` dígito verificador del CUIT · `ee92ad8` muestra del comprobante · `faa72c3` el mostrador perdía el pedido de comprobante |
| Lock de staging | `taba2-staging-mutation.lock` **ocupado** (OWNER=TABA2_FIRST_PHYSICAL_E2E, HOLDING, `ARCA_SCOPE=EXCLUIDA`). No se tocó, no se borró, no se completó. **Todo el trabajo es local.** |
| Staging / producción / ARCA real | **Intactos.** Ninguna migración aplicada a staging, ninguna Edge Function desplegada, ningún comprobante emitido en ningún ambiente. |
| Ambiente ARCA usado | Ninguno: falta el certificado (§10). Producción sigue bloqueada por triple defensa. |

---

## 1. Veredicto

El circuito fiscal completo está **cerrado de punta a punta con fixtures
sintéticos** y verde en todos los gates. Cada paso —desde un pedido pagado
sintético hasta el documento fiscal en el Panel, incluida la recuperación
después de una caída— tiene una prueba automática que corre en cada cambio.

**Y ahora se configura una vez y factura solo.** Walter y su contador recorren
seis pasos en el Panel; cuando los seis están completos, cada venta cobrada se
factura sola y el operador sólo mira la pantalla si algo entra a la bandeja de
excepciones. El runbook está en `ARCA-ONBOARDING-RUNBOOK.md`.

Esta fase encontró y cerró **seis defectos que la fase anterior no había
visto**. Tres habrían impedido facturar, uno filtraba datos fiscales al
repartidor, y uno hacía que el mostrador cobrara sin pedir el comprobante que el
operador había tildado, sin decirlo (§2).

**Lo que sigue sin estar, y no se disfraza:** la certificación contra la
HOMOLOGACIÓN oficial de ARCA. No es un pendiente de software. Falta el
certificado X.509, y obtenerlo exige una persona con Clave Fiscal frente a
WSASS. Ver §10 y §11.

---

## 2. Lo que esta fase encontró

Ninguno estaba en el informe anterior. Salieron de contrastar el código contra
el manual WSFEv1 vigente, contra el modelo de roles real, y de perseguir un
test que fallaba de a ratos en vez de declararlo intermitente.

### D10 — el detalle de IVA se armaba por línea, no por alícuota

El manual es explícito (**error 10022**): *"El campo Id en AlicIVA no debe
repetirse. Deberá totalizarse por alícuota."*

Se emitía **una entrada `AlicIva` por línea del comprobante**. Un comprobante
con dos productos al 21% —o sea, prácticamente cualquier comprobante real—
mandaba dos `AlicIva` con el mismo `Id`. **ARCA lo habría rechazado siempre.**

Cerrado: se totaliza por alícuota, con redondeo a centavos para no arrastrar
coma flotante. Probado desde la fila de base hasta el XML.

### D11 — el rider veía todos los comprobantes del negocio

Todas las superficies fiscales leían con `public.is_business_member()`, que es
verdadero para **cualquier** miembro activo: owner, admin, staff **y rider**.
Un repartidor —muchas veces un tercero— podía leer CUIT, CAE, tipo y número de
documento del receptor, importes, la huella del certificado, las intenciones de
emisión y hasta que un comprobante se había impreso.

El bucket `fiscal-documents` siempre fue privado y `service_role`, así que los
bytes del PDF nunca estuvieron expuestos. Lo que estaba expuesto era todo lo
demás.

Cerrado: la regla vive en `public.can_read_fiscal_documents()` —owner, admin,
staff— y se aplica a las nueve superficies fiscales. Un rol nuevo en
`business_members` ya no ensancha el acceso fiscal por descuido.

### D12 — un comprobante de homologación era indistinguible de uno real

El PDF de un comprobante autorizado en homologación tenía el mismo layout, un
CAE de catorce dígitos y un QR que apunta al verificador oficial de ARCA. **Nada
en el archivo decía de qué ambiente salió.** Alcanzaba con imprimirlo y
entregarlo.

Cerrado: el ambiente es un campo obligatorio del comprobante —sin valor por
omisión, así que el compilador encontró todos los lugares que no lo declaraban—
y cuando no es producción el PDF lo dice cuatro veces (§8).

### D13 — el CUIT no verificaba su dígito

El perfil fiscal validaba once dígitos y nada más. El CUIT que usaba **todo el
repositorio como fixture**, `20123456789`, tiene dígito verificador 6: no era un
CUIT. `00000000000` también se guardaba como CUIT habilitado.

El costo de no verificarlo no se paga en la configuración: se paga con un
certificado ya emitido por ARCA para el CUIT equivocado, y ese viaje a WSASS no
se deshace.

Cerrado: módulo 11 en los tres puntos donde un CUIT entra al sistema
—configuración del worker, pedido de certificado, comprobante— y un trigger en
`fiscal_profiles`. El fixture pasa a `20123456786`, que sí cierra.

### D14 — las validaciones de importes de ARCA no estaban

Se verificaba una sola: que el total fuera la suma de sus componentes. El manual
valida bastante más, y cada regla ausente es **un rechazo seguro después de
haber consumido un número de la secuencia**. Faltaban:

| Código | Regla del manual |
| --- | --- |
| 10023 | La suma de `<Importe>` en `<IVA>` debe dar `ImpIVA`. Margen: error relativo ≤ 0.01% o absoluto ≤ 0.01 × cantidad de alícuotas. |
| 10022 | El `Id` no puede repetirse; debe totalizarse por alícuota. |
| 10018 | Con `ImpIVA` > 0 el detalle es obligatorio; con `ImpIVA` = 0 sólo puede informarse la alícuota 0%. |
| 10020 | `BaseImp` mayor a cero, salvo los tipos 2, 3, 7, 8, 52 y 53. |
| 1434 / 1435 / 1438 | Clase C: `ImpTotConc`, `ImpOpEx` e `ImpIVA` en cero. |
| 1439 | Clase C: `ImpTotal` = `ImpNeto` + `ImpTrib`. |
| 1443 | Clase C: el array de IVA no debe informarse. |

Cerrado: todas, con el código de error del manual en el mensaje, y **antes de
reservar número**. Los siete tipos clase C (11, 12, 13, 15, 211, 212, 213) se
tratan como clase C.

> El fixture del puente era tipo 11 —Factura C— con IVA distinto de cero y array
> de IVA informado: inválido según 1438 y 1443. Nadie lo había notado porque
> nada lo validaba. Pasa a tipo 6, que es lo que declara la política contable.

### D15 — el mostrador cobraba sin pedir el comprobante que le habían tildado

El operador tildaba **"Solicitar comprobante fiscal"**, un refresco periódico
volvía a dibujar el mostrador, el tilde se perdía, y "Confirmar venta" cobraba
**sin llamar a `request_fiscal_document`**. La pantalla decía "Venta confirmada
por el servidor": ni una palabra sobre el comprobante que nadie pidió. La venta
quedaba cobrada y sin facturar, en silencio.

El mismo agujero se llevaba el **medio de pago**: elegir Transferencia y que un
refresco lo devolviera a Efectivo cambiaba lo que se registraba cobrado.

La causa es que el borrador de venta estaba partido: los ítems vivían en el
módulo y sobrevivían al refresco, pero el tilde y el medio de pago existían sólo
en el DOM, que es justamente lo que el refresco vuelve a dibujar. El panel ya
resolvía esto para la frase de autorización de ARCA y para el código a medio
tipear; al mostrador le faltaba.

Cerrado: el borrador entero vive en el módulo, el render lo dibuja desde ahí y
la confirmación lo lee de ahí. Cobrada la venta el borrador vuelve a cero, para
que el próximo cliente no herede el pedido de comprobante del anterior. Sin
perfil fiscal habilitado no se pide comprobante aunque quede un tilde viejo.

> Apareció como un E2E que fallaba **sólo cuando el recorrido era lo bastante
> lento** como para que un refresco cayera entre el tilde y el click, que es
> exactamente lo que pasa con una persona real frente al mostrador. Era un
> defecto real disfrazado de test intermitente.

---

## 3. Los cuatro cortes de la fase anterior (siguen cerrados)

1. **Toda venta del mostrador rompía en el primer ítem.** `checkout_pos_sale`
   escribía un `tax_snapshot` sin las cinco claves de importes que exige
   `request_fiscal_document`. Ahora desagrega neto e IVA con la alícuota de la
   política aprobada; sin política la venta se cobra igual y el snapshot dice
   `{"fiscal_pricing":"unavailable"}` en vez de fingir un precio fiscal.
2. **No había forma de crear ni aprobar una política contable.** Ahora existen
   las cuatro RPC; aprobar exige owner/admin más la frase exacta
   `I_APPROVE_THIS_FISCAL_ACCOUNTING_POLICY`.
3. **El botón de homologación no podía habilitarse nunca.** Nadie llamaba a
   `record_fiscal_credential_health`. Ahora el puente publica huella SHA-256,
   vencimiento y CUIT del certificado.
4. **`accountant_review_status` no se podía escribir desde ningún lado.** Ahora
   existe `record_fiscal_accountant_review`, con frase exacta, actor y fecha.

Y los nueve defectos contra el contrato real de ARCA (D1–D9) que documentó la
fase anterior siguen corregidos, cada uno con su prueba de regresión: orden de
`ImpTrib`/`ImpIVA` en el `xsd:sequence`, `CondicionIVAReceptorId`, SOAP Fault
sobre HTTP 500, TA persistente, lease de comprobante ya autorizado, ambigüedad
más allá del timeout, claim de outbox por CUIT y ambiente, TRA en GMT-3, y un
worker mal configurado que devuelve el intento en vez de quemarlo.

---

## 3bis. La facturación automática

### El defecto que había: se encendía guardando un formulario

`configure_fiscal_profile` aceptaba `invoice_policy='on_payment_confirmed'` e
`is_enabled=true` **sin mirar nada más**, y el disparador de pedidos se
conformaba con esos dos campos. Con el certificado sin cargar, la política
contable sin aprobar o las tablas oficiales vencidas, cada pedido pagado
encolaba una intención que no podía terminar en ningún lado: se acumulaban en
`manual_review` y el operador se enteraba tarde y de a montones. Exactamente lo
contrario de "Walter interviene sólo ante excepciones".

### Cómo quedó

**Un solo predicado de alistamiento**, `fiscal_automation_blockers()`, que
devuelve **códigos** —no prosa— de todo lo que impide facturar solo: datos del
negocio, situación fiscal, punto de venta, certificado (cargado, del CUIT
correcto y sin vencer), delegación, conexión verificada, ambiente autorizado,
política contable aprobada y tablas oficiales frescas.

**Una sola puerta**, `set_fiscal_automation()`, que lo exige, pide una frase
exacta y queda auditada en `fiscal_profile_events`. Apagarla no pide frase:
frenar nunca es la operación peligrosa.

**Y la automatización no sobrevive a un cambio que la invalide:**

| Qué pasa | Qué hace el sistema |
| --- | --- |
| Se guarda el perfil con un dato fiscal distinto | Se apaga y anota `PROFILE_CHANGED` |
| Se toca la política contable | Se apaga y anota `ACCOUNTING_POLICY_CHANGED` (aprobarla no apaga nada: la fila queda usable) |
| Vence el certificado a mitad de camino | El disparador lo detecta antes de encolar y apaga con `READINESS_LOST` |

El disparador **vuelve a verificar el alistamiento en cada pedido**: una marca
vieja no alcanza para generar basura.

### Las dos pantallas que Walter mira

`get_fiscal_automation_overview()` — alistamiento y números del día: ventas
elegibles, facturadas solas, en camino, rechazadas, requieren atención. Las
pruebas de homologación se cuentan **aparte**, para que nadie lea un número de
QA como facturación del negocio.

`list_fiscal_exceptions()` — sólo excepciones reales: configuración incompleta,
certificado, rechazo, importes que no cierran, respuesta ambigua, dato fiscal
faltante, error no recuperable. La configuración aparece como **un** problema y
no como cuarenta.

**La bandeja devuelve códigos, nunca texto de ARCA.** No es que el SOAP se
filtre y se limpie: es que no tiene camino hasta esa pantalla. La traducción a
castellano —motivo y acción concreta— ocurre una sola vez, en
`business-fiscal-assistant.js`.

### El onboarding de seis pasos

El asistente técnico tenía once pasos porque seguía el circuito de ARCA. Walter
necesita seis, y saber cuál le toca. Los seis son una **proyección** sobre los
mismos datos —no otra fuente de verdad— más el que el circuito técnico no tenía:
encender la automatización.

1. Datos del negocio · 2. Situación fiscal · 3. Punto de venta ·
4. Certificado ARCA · 5. Verificación · 6. Facturación automática

Cada uno dice **COMPLETO / PENDIENTE / ERROR**, y *falta cargarlo* no se muestra
igual que *está mal*: un certificado vencido es un problema, no un dato que
falte. El paso 6 no se puede tocar hasta que los cinco anteriores estén
completos.

**Ninguna tabla nueva.** Todo vive en `fiscal_profiles`, `fiscal_documents`,
`fiscal_emission_intents` y `fiscal_profile_events`, que ya existían.

---

## 4. Arquitectura

```
pedido pagado sintético  /  venta de mostrador cobrada
   └─ disparador idempotente (nunca puede voltear la venta ni el pedido)
        └─ fiscal_emission_intents            ← unique(negocio, origen, id, intención)
             └─ promote_fiscal_emission_intents   (worker, con lease y backoff)
                  └─ política contable aprobada + tablas oficiales frescas (< 7 días)
                       └─ fiscal_documents 'queued' + fiscal_outbox
                            └─ WSAA homologación  (TA persistente, ±reloj, CMS PKCS#7)
                                 └─ validación de importes contra el manual  ← falla acá es gratis
                                      └─ FECompUltimoAutorizado
                                           └─ reserva local del número (advisory lock + unique)
                                                └─ FECAESolicitar
                                                     ├─ CAE  → 'authorized' → PDF marcado + QR
                                                     ├─ R    → 'rejected'
                                                     └─ falla → FECompConsultar → CAE o reintento
```

**Dos defensas independientes contra la doble emisión:** unicidad de la
intención por origen, y unicidad del comprobante por
`(negocio, origen, id, intención)`. Una tercera clave de idempotencia distinta
sobre el mismo origen devuelve el comprobante que ya existe.

**La validación de importes corre antes de reservar el número.** Es deliberado:
fallar de este lado no cuesta nada; fallar en ARCA consume un número de la
secuencia y bloquea el siguiente comprobante válido.

**La venta sale de `completed_fiscal_pending`** cuando el comprobante se
resuelve —autorizado o no—. Cobrada es cobrada; el problema fiscal vive en el
comprobante, que es donde el Panel lo muestra.

---

## 5. Estados

Estados del sistema: `pending` · `processing` · `authorized` · `rejected` ·
`retry` · `manual_review`.

La UI dice exactamente cinco cosas: **pendiente · procesando · autorizado ·
rechazado · requiere atención**.

La proyección canónica está escrita **dos veces a propósito**
—`public.fiscal_public_state` y `js/core/fiscal-domain.js`— y un test compara
rama por rama las dos implementaciones sobre los trece estados reales: servidor
y pantalla no pueden divergir en silencio.

**Nunca "emitido" sin CAE.** Un `authorized` sin CAE de catorce dígitos se
muestra como *requiere atención*, no como éxito, en las dos implementaciones. Un
test recorre todas las etiquetas y todos los detalles buscando "emitido" y
"factura autorizada": no aparecen en ninguna.

---

## 6. Fixtures sintéticos

Todo lo de abajo es sintético y está marcado como tal. **Ninguno es una decisión
fiscal**: los valores reales los declara el titular o su contador.

| Dato | Valor de fixture | Nota |
| --- | --- | --- |
| CUIT | `20123456786` | dígito verificador válido; no pertenece a nadie |
| Punto de venta | `3` (base) · `5` (puente) | |
| Tipo de comprobante | `6` — Factura B | validado contra `FEParamGetTiposCbte` |
| Tipo de nota de crédito | `8` — Nota de Crédito B | |
| Condición IVA del receptor | `5` | validado contra `FEParamGetCondicionIvaReceptor` |
| Documento del receptor | tipo `99`, número `0` | validado contra `FEParamGetTiposDoc` |
| Alícuota | `5` (21%) | validado contra `FEParamGetTiposIva` |
| Concepto | `1` — Productos | |
| Moneda | `PES`, cotización `1` | |
| CAE de muestra | `99999999999999` | catorce nueves, inconfundible |
| Ambiente | `homologation` / `synthetic` | nunca `production` |

**Ninguna decisión fiscal se infiere.** Condición frente al IVA, alícuota, si el
IVA se discrimina, si los precios ya lo incluyen, tipo de comprobante, tipo de
nota de crédito, documento del receptor, concepto, punto de venta y tratamiento
del envío se declaran en la política contable. Ninguno tiene valor por omisión en
el código. Cada identificador se valida contra la tabla oficial que el puente
bajó de ARCA, con snapshot de menos de siete días, al aprobar la política y en
cada uso. Si algo no está declarado, el circuito **se detiene y pide revisión**.

---

## 7. Cobertura

`npm run fiscal:db:local` levanta su propio contenedor, aplica las **59
migraciones sobre una base vacía** y corre las tres suites pgTAP fiscales. Es
reproducible sin staging y sin ARCA.

| Escenario obligatorio | Dónde |
| --- | --- |
| CAE aprobado | `arca-circuit` · pgTAP |
| CAE rechazado | `arca-circuit` · pgTAP (13 y 15 dígitos también) |
| SOAP Fault | `config-wsaa` (incluye la respuesta real de ARCA fijada como regresión) |
| TA vencido · vigente · por vencer | `config-wsaa` |
| Retención de WSAA con y sin ticket guardado | `config-wsaa` |
| Reloj corrido | `config-wsaa` |
| Timeout después de que ARCA autorizó | `arca-circuit` |
| Retry con backoff | `arca-circuit` · pgTAP |
| Recuperación por consulta | `arca-circuit` · `wsfe-reconciliation` |
| Doble emisión / doble click | `arca-circuit` · pgTAP |
| Concurrencia (dos workers) | `arca-circuit` · pgTAP |
| Montos incorrectos | `fiscal-money` (10048, 10023, 10022, 10018, 10020, clase C) |
| Numeración correlativa | `arca-circuit` · pgTAP |
| Permisos y RLS | pgTAP (incluye rider) |
| Caída de ARCA (503) | `arca-circuit` |
| **Reinicio del worker** | `arca-circuit` (tres casos) · `config-wsaa` (TA persistente) |
| Onboarding incompleto / completo | pgTAP §1bis y §11bis · `business-fiscal-onboarding` |
| Activación y desactivación | pgTAP §11bis · unit · E2E |
| Automatización suspendida por cambio | pgTAP §13 (política) y §18 (certificado vencido) |
| **Venta que se factura sola, sin operador** | pgTAP §15bis |

**Reinicio del worker**, los tres estados que deja una caída real:

1. ARCA autorizó y no lo supimos → consulta primero, adopta el CAE que ya
   existía y **no consume un segundo número**.
2. ARCA nunca lo recibió → consulta, no encuentra nada y **conserva el mismo
   número reservado** en vez de quemar otro.
3. El comprobante ya estaba resuelto → cierra el lease sin una sola llamada.

**La venta se factura sola** (pgTAP §15bis): desde que el pedido queda pagado
hasta el CAE no interviene ninguna persona. El disparador encola la intención,
el promotor arma el comprobante, el worker reserva el número y ARCA autoriza; el
Panel lo muestra autorizado con CAE y **no aparece en la bandeja de
excepciones**, porque no hubo excepción. En el medio el trabajo pasa por un
worker mal configurado que suelta el lease, y el worker correcto lo termina: la
recuperación también es automática.

**Dinero:** neto, IVA, exento (`ImpOpEx`), no gravado (`ImpTotConc`), otros
tributos, total, redondeo, descuento prorrateado al centavo, envío como línea
propia con su tratamiento declarado, totalización por alícuota sin arrastre de
coma flotante, y márgenes de error idénticos a los del manual.

**La propia herramienta de certificación tiene prueba automática**: recorre
credenciales → `FEDummy` → WSAA → tablas oficiales → último autorizado →
`FECAESolicitar` → `FECompConsultar` contra la ARCA simulada, verifica que la
consulta por número devuelva el mismo CAE, y comprueba que la evidencia no
contenga token, sign, PEM ni XML crudo. También verifica que se niegue sin la
frase de consentimiento, que se niegue contra producción, y que un rechazo de
ARCA no se declare certificación exitosa.

---

## 8. El documento fiscal

El PDF lleva tipo de comprobante de la tabla oficial, punto de venta, número,
fecha, moneda, receptor, detalle por línea, los cinco importes, total, CAE,
vencimiento del CAE, QR versión 1 y **estado**.

Cuando el ambiente no es producción, lo dice **cuatro veces**:

- un aviso en caja roja arriba y otro abajo, con `SIN VALIDEZ FISCAL`;
- una marca de agua diagonal en **todas** las páginas —recortar la primera o
  imprimir sólo la última no alcanza para perder el aviso—;
- `Ambiente: HOMOLOGATION` (o `SYNTHETIC`) como un dato más del comprobante;
- el título, el asunto y las palabras clave del archivo
  (`[HOMOLOGATION] …`, `NO_VALIDO_COMO_COMPROBANTE`).

El worker de artefactos toma el ambiente **de la fila del comprobante**, no de
su propia configuración, y se niega a generar nada si la fila no lo declara: un
ambiente desconocido no se adivina. La suite lee el PDF generado —no el input— y
verifica que diga lo que tiene que decir, que producción no lleve ninguna de esas
marcas, y que haya exactamente una marca de agua por página.

Para verlo con los ojos antes de que exista un comprobante real:

```powershell
npm run fiscal:sample -- --out <ruta absoluta .pdf>
```

Genera el mismo PDF que produce el worker, con el mismo generador y el mismo
layout, con datos de fixture y ambiente `synthetic`. No acepta un caso fiscal ni
un CAE de afuera a propósito: esa herramienta no puede fabricar algo que se
parezca a un comprobante emitido.

---

## 9. Seguridad

- **Rider sin acceso fiscal.** `can_read_fiscal_documents()` = owner, admin,
  staff. La suite verifica que el rider siga siendo miembro activo del negocio y
  aun así no vea una sola fila fiscal, y que ninguna política fiscal conserve el
  predicado viejo.
- La ruta de storage del PDF **no la lee nadie con rol `authenticated`, ni el
  owner**: el Panel la pide por RPC y el puente la escribe con `service_role`.
- Clave privada y certificado se montan como **rutas absolutas fuera del
  repositorio**; las variables rechazan cualquier valor que parezca un PEM o que
  no sea absoluto.
- El **Ticket de Acceso** persiste como el secreto que es: archivo 600,
  escritura atómica, fuera del repositorio. Un archivo ilegible se trata como
  "sin ticket", no tumba el worker.
- `record_fiscal_credential_health` es **service_role únicamente**.
  `claim_fiscal_outbox`, `promote_fiscal_emission_intents`,
  `release_fiscal_outbox_lease`, `settle_completed_fiscal_outbox` e
  `internal_create_fiscal_document` están revocadas para `authenticated`, y hay
  prueba de que lo están.
- `fiscal_accounting_policies` **no es legible directamente ni por el owner**.
- El logger filtra por nombre de campo
  `token|sign|secret|password|certificate|private key|service role|recipient`, y
  un test le pasa un token con marca y verifica que no aparezca en la auditoría.
- `secrets:scan` limpio. Cero secretos en el frontend.
- Producción sigue bloqueada por triple defensa: variable de entorno con frase
  propia, `production_gate_status` en la base y el trigger
  `assert_fiscal_execution_authorized`. La política de producción **no se puede
  declarar ni aprobar desde el Panel**.

---

## 10. Gates

| Gate | Resultado |
| --- | --- |
| `npm test` | **1126/1126** (+13 del onboarding fiscal) |
| `npm run fiscal:test` | **81/81** (base de la fase anterior: 50) |
| `npm run fiscal:db:local` | **222 aserciones** sobre PostgreSQL **vacía**: 60 migraciones desde cero + 151 + 41 + 30 |
| `npm run migrations:validate` | aprobado |
| `npm run check` | pasa |
| `npm run secrets:scan` | limpio |
| `npm run test:e2e` | **209/209** (Chromium + Firefox) |
| `git diff --check` | limpio |
| Certificación en homologación oficial | **PENDIENTE — falta el certificado (§11)** |

---

## 11. Contacto real con la homologación oficial (sin certificado)

Los mocks no bastan, y no se usaron para esto. `FEDummy` es el único método de
WSFEv1 que, según el WSDL vigente, **no lleva `Auth`**. `npm run fiscal:probe` lo
corre contra el endpoint oficial, y con `--wsaa` intenta además autenticar.

Corrida del **2026-08-07**, con el código de este worktree:

| Operación | Endpoint real | Resultado |
| --- | --- | --- |
| `FEDummy` | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` | HTTP **200** · `AppServer=OK` `DbServer=OK` `AuthServer=OK` |
| `loginCms` | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` | HTTP **500** · SOAP Fault `ns1:cms.cert.blacklist` · "Certificado bloqueado" |

Queda probado contra ARCA de verdad: TLS, DNS y la allowlist; el sobre SOAP 1.1,
el header `SOAPAction` y el parser XML con anti-XXE contra una respuesta real; y
que **el TRA y el CMS/PKCS#7 son correctos** —WSAA llegó a *evaluar el
certificado*: no rechazó por schema, ni por `generationTime` en el futuro, ni por
formato de fecha, que son los tres errores que el manual documenta como los más
frecuentes—. La detección de desfase de reloj contra el header `Date` real de
ARCA dio **0 segundos**.

El certificado usado para esa sonda fue **autofirmado y sintético**, generado
sólo para esa verificación y **borrado inmediatamente después**. **No se emitió
ningún comprobante, no se consultó ningún padrón y no se tocó producción.**

Esto es validación de transporte y autenticación, **no es la certificación
fiscal**: sin certificado emitido por ARCA no hay Ticket de Acceso, y sin Ticket
de Acceso no hay CAE.

---

## 12. HUMAN_CHECKPOINT_ARCA_CERTIFICADO_HOMOLOGACION

> **La única acción que falta:** entrar a **WSASS** con Clave Fiscal y obtener el
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
`/C=AR/O=<empresa>/CN=<sistema>/serialNumber=CUIT <11 dígitos>`. **Verifica el
dígito verificador del CUIT antes de generar nada.** Se niega a escribir dentro
del repositorio y se niega a pisar una clave existente. La clave privada nunca se
imprime.

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

### Exactamente qué hay que aportar, y quién

Nada de esto se pide todavía: se pide **con el certificado en mano**, porque
recién ahí cada identificador se puede validar contra las tablas oficiales que
el puente baja de ARCA. Validarlo es justamente lo que impide inventarlo.

**Walter** (paso 1, 3 y 4 del onboarding):

| Dato | Dónde se carga |
| --- | --- |
| Razón social, tal como figura en ARCA | Datos fiscales |
| CUIT de La Taba, once dígitos | Datos fiscales (se verifica el dígito verificador) |
| Domicilio comercial | Datos fiscales |
| Número de punto de venta, dado de alta en ARCA para factura electrónica | Datos fiscales |
| El certificado X.509 de homologación, sacado de WSASS | Se lo entrega a soporte; se monta en el servidor |

**El contador** (paso 2):

| Decisión | Por qué no se puede inferir |
| --- | --- |
| Condición del negocio frente al IVA | Determina la clase de comprobante (A, B, C, M) |
| Condición del receptor frente al IVA | Viaja en `CondicionIVAReceptorId`, tabla oficial |
| Tipo de comprobante y tipo de nota de crédito | Se valida contra `FEParamGetTiposCbte` |
| Tipo y número de documento del receptor | Se valida contra `FEParamGetTiposDoc` |
| Alícuota de IVA y si va discriminado | Se valida contra `FEParamGetTiposIva` |
| Si los precios de lista ya incluyen IVA | Cambia cómo se desagrega neto e IVA al centavo |
| Concepto: productos, servicios o ambos | Determina si hay período y vencimiento de pago |
| Tratamiento fiscal del envío | Sin esto, un pedido con envío va a revisión |

**Soporte** monta el certificado y la clave privada fuera del repositorio y
corre `credentials:check`. La clave privada nunca sale del servidor.

Con eso cargado y aprobado, el paso 6 del onboarding se habilita solo y la
facturación automática se puede encender.

---

## 13. Riesgos y reservas explícitas

1. **La certificación en homologación oficial NO está hecha.** Falta el
   certificado. Todo lo que la habilita está construido y probado; nada de eso
   la reemplaza. Los mocks no bastan y no se presentan como si bastaran.
2. **Un comprobante que ARCA nunca recibió queda esperando a una persona.** Si
   el proceso muere antes de que ARCA reciba el `FECAESolicitar`, cada reintento
   consulta, no encuentra nada y conserva el número; al agotar los intentos cae
   a `manual_review`. Es deliberado: reenviar a ciegas es la única forma de
   emitir dos veces, y cero doble facturación gana sobre cero intervención.
   Un reenvío seguro sería posible —`FECompConsultar` sin resultado **más**
   `FECompUltimoAutorizado` menor al número reservado prueban que ARCA no lo
   tiene— pero es un cambio de comportamiento de emisión y no se hizo sin
   certificado con qué verificarlo.
3. **El dígito verificador del CUIT es necesario, no suficiente.** Once ceros lo
   cumplen y no son el CUIT de nadie. Quien decide eso es el padrón de ARCA; esa
   regla no se inventó acá.
4. **La política contable de ejemplo no es una decisión fiscal.** Los valores de
   `docs/arca/homologation-case.example.json` y del fixture pgTAP son sintéticos
   y están marcados como tales.
5. **Nada se aplicó a staging.** El lock estaba ocupado por otra sesión, con
   `ARCA_SCOPE=EXCLUIDA`. Las cuatro migraciones nuevas están validadas
   estáticamente y aplicadas sobre una base local desde cero, pero **no** contra
   `la-taba-staging`.
6. **La cotización queda en 1 y la moneda en PES.** Moneda extranjera exige
   `FEParamGetCotizacion` y una decisión contable que nadie tomó: el circuito no
   la ofrece en vez de aproximarla.
7. **`FECAEASolicitar`, exportación, `wsmtxca` y regímenes especiales siguen
   fuera de alcance.**
8. **Las notas de crédito automáticas siguen siendo manuales**: existen las RPC y
   están probadas, pero ningún disparador las emite solo.
9. **El puente no está desplegado.** Corre local. Su despliegue en red privada
   es una tarea de infraestructura documentada en `docs/arca/README.md`.
10. **Hallazgo ajeno, reportado sin tocar.**
    `20260806160000_order_qa_origin_classification.sql` no se puede aplicar sobre
    una base vacía: hace `create or replace function public.get_rider_queue(uuid)`
    cambiando sus columnas `OUT`. En staging ya está aplicada, así que nadie lo
    notó. El arreglo real es una línea —`drop function if exists
    public.get_rider_queue(uuid);` antes del `create or replace`— pero pertenece
    a otra línea de trabajo y no se tocó la migración histórica. El harness local
    lo sortea con un `drop` explícito y comentado.

---

## 14. Declaración

El circuito fiscal sintético de TABA2 está completo y verde: pedido pagado
sintético → job fiscal → configuración fiscal fixture → WSAA simulada fiel →
Token/Sign → `FECompUltimoAutorizado` → numeración → validación de importes →
`FECAESolicitar` → CAE aprobado o rechazado → persistencia → documento fiscal
marcado → Panel → recuperación y reintento, incluido el reinicio del worker.

Cuatro cortes de contrato cerrados, quince defectos contra el contrato real de
ARCA corregidos, cero decisiones fiscales inferidas, dos defensas independientes
contra la doble emisión, el rider fuera de todo dato fiscal, y un documento que
no se puede confundir con un comprobante real.

**TABA2_ARCA_SYNTHETIC_FISCAL_FLOW_CERTIFIED**

Y sobre eso, la facturación automática configurable: seis pasos de onboarding
con COMPLETO/PENDIENTE/ERROR, una sola puerta que exige el alistamiento completo
para encenderla, un tablero que separa las pruebas de las ventas, y una bandeja
que muestra sólo lo que necesita a una persona, en castellano y con una acción
concreta. Una venta sintética pagada llega al CAE sin que nadie toque nada.

**TABA2_ARCA_AUTOMATED_FISCAL_ONBOARDING_SYNTHETICALLY_CERTIFIED**

La declaración `TABA2_ARCA_HOMOLOGATION_FISCAL_FLOW_CERTIFIED` **NO se emite**, y
no se va a emitir contra mocks. Requiere una corrida contra los endpoints
oficiales —`wsaahomo.afip.gov.ar` y `wswhomo.afip.gov.ar`— con un certificado
real. Ese es el único paso que falta, está bloqueado en
**HUMAN_CHECKPOINT_ARCA_CERTIFICADO_HOMOLOGACION**, y el comando que produce su
evidencia ya está escrito y probado.

Declarar certificado contra ARCA un circuito que nunca habló con ARCA sería
exactamente la clase de mentira que este trabajo vino a eliminar.
