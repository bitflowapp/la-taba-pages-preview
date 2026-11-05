# Mobbex — certificación sin dinero real

Alcance: PR #164 (rama `feat/la-taba-mobbex-checkout`). Nada de esto toca producción ni staging remoto, activa pagos reales ni
despliega. Para el veredicto GO/NO-GO ver [README.md](README.md#go--no-go).

## 1. Qué está certificado y con qué

| Capa | Comando | Qué prueba | Qué NO prueba |
|---|---|---|---|
| Lógica Edge pura | `node --import ./tests/test-bootstrap.mjs --test tests/mobbex-*.test.mjs` | webhook falso/duplicado/tardío, snapshots, cliente HTTP, flujos con puertos falsos, plantilla del cron | nada contra Mobbex ni Supabase reales |
| Contrato Edge ↔ base | `tests/mobbex-edge-sql-contract.test.mjs` (incluido arriba) | cada `enforceRateLimit` usa un scope aceptado por la base; cada `rpc()` nombra una función y argumentos que existen; las RPC del navegador son exactamente las concedidas a `authenticated` | el comportamiento de esas funciones (lo cubre el banco SQL) |
| Tipos bajo Deno | `npm run check:edge` | `deno check` (Deno 2.6.1 fijado, `deno.lock` congelado) de las 19 entradas Edge: **pasa** | ejecución bajo Deno |
| Lógica Edge bajo Deno | `npm run test:mobbex:deno` | las 37 pruebas de `mobbex-core` y `mobbex-flows` ejecutadas **bajo Deno 2.6.1** (versión fijada, lock congelado, sin permiso de red), sin cambiar una línea de las pruebas | `supabase functions serve` ni los `index.ts`; sólo Deno como runtime de la lógica |
| SQL en PostgreSQL real | `TABA_LOCAL_PAYMENT_DB=1 node scripts/mobbex/run-mobbex-db-tests.mjs --native` (o sin `--native` con Docker sano). **En CI:** job `financial_sql` (PostgreSQL 16 del runner) | libro (97 aserciones), huella de funciones preexistentes idéntica, rollback, alerta de salud (22 aserciones) con rollback byte a byte | un Supabase real: el banco nativo usa **stubs** de `pg_cron`/`pg_net`/`supabase_vault` (fixture más débil que la imagen fija); la imagen fija en Docker no se ejecuta en ningún lado |

### Deno en esta máquina

- La unidad C: no tiene espacio. `deno` descarga dependencias a `DENO_DIR`; **definirlo fuera de C:** antes de correr
  `npm run check:edge` (por ejemplo una carpeta `deno-cache` junto al repositorio). Sin eso Deno escribe en `%LOCALAPPDATA%`.
- `npm run check:edge` baja Deno con `npx deno@2.6.1` y los paquetes del lockfile; no modifica `deno.lock` (`--frozen`).
- **Hecho:** la lógica de las funciones (núcleo y flujos, 37 pruebas) también corre bajo el runtime de Deno: `npm run test:mobbex:deno`,
  en el CI. **Pendiente (no hecho):** `supabase functions serve` con los `index.ts` reales y una pila Supabase local sana
  (Docker dañado, ver `INFRA-RECOVERY.md`).

## 2. E2E sin dinero real (preparado, NO ejecutado)

Bloqueo real: **no hay cuenta ni credenciales de prueba de Mobbex** (las emite el titular, ver README §4). Hasta entonces el
recorrido de navegador no se puede completar contra el proveedor. Plan, en orden y todo en modo `test`:

1. Credenciales de **prueba** del titular como secrets del entorno local (`MOBBEX_ENABLED=true`, `MOBBEX_ENVIRONMENT=test`,
   `MOBBEX_API_KEY`, `MOBBEX_ACCESS_TOKEN`, `MOBBEX_WEBHOOK_TOKEN_SECRET` ≥ 32 caracteres). Nunca en el repo.
2. Contrato real del sandbox: `node scripts/mobbex/sandbox-contract-probe.mjs` y luego `scripts/mobbex/sandbox-pay-probe.mjs`
   (el pago aprobado necesita una persona: el checkout alojado está detrás de un desafío anti-bots). Comparar la respuesta
   *aprobada* con el fixture de `tests/mobbex-core.test.mjs`: es la única evidencia que falta sobre la forma real de la lectura.
3. Comprobar en esa misma corrida los dos puntos abiertos del README §8: una compra **en cuotas** (¿`payment.total` incluye
   financiación?) y una referencia con **un intento rechazado y luego uno aprobado** (¿qué operación es la principal?).
4. Navegador: comercio de prueba con `configure_mobbex_business(..., 'test', ...)`, Mobbex visible en el checkout, pago con
   tarjeta de prueba, vuelta a `pago/mobbex/`, pedido creado una sola vez, carrito limpio sólo con `completed` del servidor.
5. Casos negativos en navegador: volver sin pagar, cerrar la pestaña y reabrir, doble clic en «Pagar», reintento con otra tarjeta.
6. Con `MOBBEX_ENABLED` distinto de `true` la opción debe desaparecer sin recargar datos del comercio.

Criterio de salida: ningún paso mueve dinero real (credenciales y tarjetas de prueba), y los puntos 2 y 3 quedan con evidencia escrita.

## 3. Programar la conciliación

`deploy/mobbex/mobbex-worker-cron.template.sql` **está preparado y no se despliega**: no está en `supabase/migrations`, crear su función
no programa nada y la línea de `cron.schedule` está comentada. Antes de activarlo, quien despliega debe:

1. Tener en Vault `taba_payment_worker_hmac_secret` (el mismo de Mercado Pago) y `taba_mobbex_worker_url`
   (`https://<proyecto>.supabase.co/functions/v1/mobbex-worker`).
2. Confirmar que `PAYMENT_WORKER_SECRET` del entorno es ese mismo secreto.
3. Aplicar la plantilla y, **sólo cuando se decida habilitar Mobbex**, ejecutar la línea comentada de `cron.schedule`.

Trampa conocida (cubierta por `tests/mobbex-worker-cron-template.test.mjs`): el validador de firma del worker ata el manifiesto a la ruta
canónica de `mercadopago-payment-worker`, sea cual sea la función llamada. Firmar con la ruta de `mobbex-worker` produce 401 silencioso.

## 4. Habilitar la alerta de salud (cuando se quiera)

```sql
select public.set_mobbex_health_alert('<id del comercio>', true);   -- rol de servicio
select public.set_mobbex_health_alert('<id del comercio>', false);  -- apagarla
```

Por defecto está apagada y la reconciliación de alertas del panel se comporta igual que sin la migración. Con ella encendida el panel
muestra `MOBBEX_PAID_WITHOUT_ORDER` (crítica), `MOBBEX_PAYMENT_NEEDS_REVIEW` y `MOBBEX_RECONCILIATION_STUCK`, con el ciclo
reconocida → resuelta y auto-resolución cuando la condición desaparece. La evidencia es sólo un conteo y códigos de motivo.

## 5. Revisión contra la documentación oficial (2026-11-04, sesión 3)

Re-lectura de mobbex.dev (`/webhooks`, `/suscriptores`, `/codigos-de-estado`, `/medios-de-pago-para-pruebas`, `/primeros-pasos`):

- **Formato del webhook contradictorio en la propia documentación.** `/webhooks` dice `Content-Type: application/json`;
  `/suscriptores` dice «Los webhooks siempre serán enviados en formato `application/x-www-form-urlencoded`», y la lectura real
  de una entidad del sandbox expone `settings.webhookFormat` (el formato es configurable por cuenta). Antes, un aviso
  form-urlencoded con token válido se rechazaba con 401 (sólo quedaba la conciliación). **Ahora se aceptan ambos** como
  *pista* (`formBodyToObject` en `webhook.ts`, sin recorrer `__proto__`/`constructor`/`prototype`); el estado sigue saliendo
  sólo de la lectura autenticada. Pruebas: `webhook parsing…` (core) y `webhook: a request without the capability token…` (flows).
- **Operación de prueba en producción.** El snapshot ahora lleva `test` (sólo un booleano `true` explícito del proveedor) y el
  libro la rechaza como dinero en producción: `test_operation_in_production` → revisión, sin pedido. Aserción nueva en
  `supabase/tests/mobbex_ledger.local.sql` §11 (97 en total).
- **Tabla de estados:** la de `status.ts` coincide código por código con `/codigos-de-estado` (0-4, 100, 200-303, 400-419, 500,
  600-610, 800). Sin cambios.
- **Credenciales DEMO públicas** (`/primeros-pasos`): existen y sirven para el contrato de API sin cuenta propia; el pago
  aprobado/rechazado/pendiente sigue necesitando a una persona en el checkout alojado (Turnstile). **No se evade.**

## 6. Contrato REAL de la consulta de operaciones (2026-11-04, sesión 6)

Medido con las credenciales DEMO públicas, **sólo lectura**, sobre operaciones de prueba que ya existían en la cuenta DEMO
compartida (no se creó ningún checkout ni se movió dinero; se imprimieron sólo formas, códigos y booleanos, nunca datos de
personas). Documentación: `/consulta-de-operaciones-y-childs` (el segmento es el UID; una referencia va con prefijo `REF:`).

| Consulta | Operación aprobada existente | Referencia creada y no pagada | Referencia nunca usada |
|---|---|---|---|
| `GET /p/operations/{referencia}` (lo que usaba el adaptador) | `result:false`, `GENERIC:EFCS` | `GENERIC:EFCS` | `GENERIC:EFCS` |
| `GET /p/operations/REF:{referencia}` | **encontrada** (`data.transaction.payment`) | `result:false`, `NDFE` | `NDFE` |
| `GET /p/operations/{uid}` | encontrada | — | — |
| `GET /p/entity/operations?reference=…` | 0 resultados **sin** `test=true`; 1 con `test=true` | 0 | 0 |

Otros hechos medidos:

- **DEFECTO CRÍTICO corregido:** con la ruta vieja ningún pago se habría confirmado nunca. El cliente habría pagado, el
  libro habría contado "sin operación" y, tras vencer la sesión + 3 h + 5 lecturas, habría cerrado el intent y liberado
  el stock (`reconcile.closed_without_payment`). La sesión 2 interpretó `GENERIC:EFCS` como "no hay operación": era la ruta
  equivocada. Ahora: `REF:` y **sólo `NDFE`** cuenta como ausencia; `EFCS`, otro `result:false` o un 404 son fallas
  reintentables (nunca alimentan el cierre).
- Una operación de prueba trae `payment.currency.code = "TEST"` ("Test Money") y **ningún booleano `test`**. El snapshot
  la marca `test:true` y la lee como ARS: el sandbox la puede confirmar y producción la rechaza (`test_operation_in_production`).
- `REF:` devuelve sólo el **intento más reciente** (medido en 3 referencias con 2-6 intentos) y `data.transactions` vino
  **vacío** en todas las respuestas reales: la defensa "intento aprobado anterior + titular rechazado" no tenía datos. Ahora
  el cliente lee los intentos con `/p/entity/operations` (`test=true` en sandbox); si esa lista falla sólo decide un titular
  que no libera stock (ver sección 7).
- Estado `501` (no documentado) con texto real "Error, Entidad Inválida / Pago declinado. Comercio inválido": todos los
  checkouts web recientes de la cuenta DEMO terminan así. Queda `unknown` (revisión). **Para el pago con persona usar las
  credenciales sandbox propias del comercio**: con las DEMO el pago probablemente se rechace con 501.
- En la respuesta real `payment.total` puede superar `requestedTotal` (recargo de financiación: visto 972615 vs 926300 en
  un 501). El libro compara contra `total` → un pago en cuotas con recargo iría a `amount_mismatch` (revisión, falla
  cerrado). **A confirmar con Mobbex** qué importe acredita el comercio antes de habilitar cuotas con interés.
- Adaptador real (`client.ts` + `snapshot.ts`) ejecutado contra la API DEMO: operación aprobada existente → `approved`,
  ARS, `test:true`, importe e id coinciden, 1 intento listado; referencia no pagada → `found:false`, `NDFE`.
- El checkout `CHK:SJ6VC9OUJ6B13C5LU4` (referencia `taba2-mbx-de30fefb-…`): **ninguna operación** (`NDFE`, 0 en la lista con
  `test=true`). Nadie lo pagó; la sonda vieja tampoco lo habría detectado si alguien pagaba.
- No hay mecanismo oficial para aprobar un pago sin checkout alojado salvo la **integración transparente**
  (`POST /p/operations/{intent_token}` con datos de tarjeta), que según `/integracion-transparente` "no podrá utilizarse si no
  se contacta previamente" a Mobbex y exige PCI DSS. **No se usó.** Tampoco hay simulador de webhooks documentado.
- Sondas: `scripts/mobbex/sandbox-pay-probe.mjs --reference taba2-mbx-<uuid>` relee un checkout existente sin crear otro.

## 7. Sesión 7 (2026-11-04): lista de intentos ilegible + titular que libera stock

Sin consumo de API (cero llamadas a Mobbex, cero checkouts, cero dinero): análisis estático y pruebas locales sintéticas.

**Verificado sin cambios:** `getOperationByReference` usa `REF:`; sólo `NDFE` es «sin operación»; `EFCS`, otro `result:false`, 404, 5xx, 429,
401/403, timeout y respuesta no JSON son fallas reintentables que nunca llegan a `recordNoOperation` (`handlers.ts:222-229`).

**Defecto (demostrado con prueba que falló antes del arreglo):** `REF:` devuelve sólo el intento más reciente. Si la lista
`/p/entity/operations` fallaba (`attempts === null`), `buildMobbexSnapshot` aceptaba el titular solo. El libro libera el stock con un
titular `rejected` con la sesión vencida (`foundation.sql:1093`) y con `expired`/`cancelled` de un pago no cobrado (`:1105`). Un intento
anterior pagado quedaba invisible: stock liberado de una compra cobrada, con un fallo transitorio de la lista como único disparador.

**Cambio mínimo:** `snapshot.ts`: con `attempts === null`, sin `transactions` embebidas y titular `rejected|expired|cancelled`, devuelve
`conflicting_operations` (el job falla, reintenta con backoff y termina en dead-letter/alerta; nunca en una conjetura). `undefined`
(el llamador nunca tuvo lista), `pending`, `authorized`, `unknown` y `approved` no cambian. **Costo:** si la lista falla de forma persistente,
un rechazo/expiración real se registra más tarde (el stock se retiene más tiempo): se prefiere eso a liberar dinero cobrado.
Prueba: `snapshot uses the listed attempts…` en `tests/mobbex-core.test.mjs` (ahora con lista ilegible y los códigos 300/401/402/403/600/601/610).

**No verificado (necesita sandbox propio o persona):** forma real del titular cuando hay un intento aprobado y otro rechazado en la misma
referencia; si `status` de la lista llega como objeto (`listAttempts` sólo acepta texto/número: un objeto se lee `''`/unknown y no cuenta como pago);
`payment.total` con cuotas; orden real de los webhooks.

**Cierre sesión 7 (2026-11-05):** el hueco del `status` como objeto se cerró sin medir la forma real: `listAttempts` lee `status.code`
y, si algún intento de la referencia tiene un estado ilegible, toda la lista es `null` (nunca una lista parcial que omita el pago), con
lo que rige la regla anterior. Verificado: `npm test` (3421+), `npm run check`, `npm run check:edge`, `npm run test:mobbex:deno` (46).
El banco SQL local no se ejecutó (sin CLI de Supabase instalada; el cambio no toca SQL). Sigue sin medirse la forma real de la lista.
