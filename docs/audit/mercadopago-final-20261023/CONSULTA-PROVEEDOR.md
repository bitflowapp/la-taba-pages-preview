# Escalamiento técnico — Checkout Pro MLA, error antes de crear el pago

> **Actualización 23/10/2026, 20:15 UTC: NO ENVIAR.** La causa era nuestra configuración: la aplicación integradora de QA (TABA2 Staging) pertenece a una cuenta real, y Mercado Pago rechaza un pago marketplace que mezcla usuarios reales y de prueba (`2034 Invalid users involved`). Con una integradora de dueño de prueba, APRO aprobó (pago `184722117633`). Ver [causa-raiz-20261023/CAUSA-RAIZ.md](causa-raiz-20261023/CAUSA-RAIZ.md). La única consulta que corresponde hacer ahora es sobre reembolsos en el entorno de prueba (§7 de ese documento).

**Estado: preparado, todavía no presentado en el portal.** No se obtuvo un nuevo número de ticket. El repositorio registra el antecedente `WCS-51579`; su estado y la posibilidad de actualizarlo requieren verificarlo en la sesión del titular. No se afirma que esta actualización haya sido enviada.

## Caso para Mercado Pago

Solicitamos el diagnóstico interno de un flujo de Checkout Pro marketplace mediante OAuth. Entorno y participantes exclusivamente de prueba. Existe un único envío documentado y ninguna transacción para su referencia; no se repetirán pagos sin una hipótesis nueva sustentada.

### Identificadores y tiempos

| Dato | Valor |
|---|---|
| Aplicación integradora | `2691240967769590` |
| Vendedor oficial de prueba | `3594962708`; `/users/me` confirma `test_user` y MLA |
| Comprador oficial de prueba | `3594962710`; identidad contrastada e inicio de sesión anterior al checkout |
| preference_id | `3594962708-171128df-3092-4de2-96ee-f1f6383efe3d` |
| external_reference | `taba2:checkout:418a456b-d119-4518-9478-8c286c39d85d` |
| flow_id del envío | `f134432b-3420-4d6c-b14f-e3d7b1cb72f9` |
| checkout_session_id de La Taba | `418a456b-d119-4518-9478-8c286c39d85d` |
| payment_intent_id de La Taba | `55136b0c-aa3b-44db-a7bd-b419a8a3af4f` |
| payment_attempt_id de La Taba | `21372d31-1697-4915-8de9-16dd7e01632f` |
| Único clic en Pagar | **23/10/2026 15:16:19.121 Argentina**, `2026-10-23T18:16:19.121Z` |
| Error observado | **23/10/2026 15:16:32.675 Argentina**, `2026-10-23T18:16:32.675Z`; hora de observación, no timestamp interno del fallo |
| Expiración | 23/10/2026 15:26:56.950 Argentina, posterior al envío |
| Importe y escenario | ARS 100, una cuota, escenario oficial de prueba APRO |
| Navegador | Chrome `155.0.8059.85` en Windows, contexto aislado controlado con Playwright |

### Request IDs y HTTP recuperables

1. **Respuesta del proveedor al crear la preferencia:** `2974654e-1bb5-4cde-ba43-0b53013914e3`, recuperada de `payment_attempts.provider_request_id`. El código persiste `x-request-id` y, si falta, `x-correlation-id`; el registro no conserva cuál de los dos aportó el valor. Identifica la **creación de preferencia**, no el envío fallido.
2. **Gateway de La Taba, creación de sesión:** `01a169f6-5e25-7465-a0f2-363423a50514`, ejecución `b8a42431-f9fa-455b-90fc-4a36ddd652f5`, HTTP **200**, `2026-10-23T18:11:57.049Z`.
3. **Gateway de La Taba, creación de preferencia:** `01a169f6-6240-7dcd-b7e3-3bc91b5e13ec`, ejecución `6effd37d-f27f-4471-8aeb-a65df97c25b2`, HTTP **200**, `2026-10-23T18:11:58.978Z`.
4. **HTTP, endpoint interno, x-request-id y x-correlation-id del fallo al pagar:** **no disponibles en la evidencia conservada**. El `browser.jsonl` original tiene 60 registros, uno de ellos `pay_submitted`, sin respuestas HTTP ni eventos de red del proveedor. No hay HAR ni netlog en el directorio de esa ejecución. La pantalla `/error/` no permite inferir un 4xx, 5xx o error funcional sobre 2xx.

No atribuimos a este intento los 404 de pruebas históricas, los 502 de notificaciones anteriores ni el 401 posterior de una llamada manual al worker. El error de la herramienta al seguir el login del soporte tampoco constituye un HTTP 500 del checkout.

### Comportamiento y configuración comprobados

La carga de la tarjeta oficial de prueba llegó a cuotas y a la revisión por ARS 100. Tras pulsar Pagar una sola vez se observó `https://www.mercadopago.com.ar/checkout/v1/payment/redirect/f134432b-3420-4d6c-b14f-e3d7b1cb72f9/error/`, con **«Oh, no, algo anduvo mal»** y botón Reintentar. No se accionó Reintentar. No hay navegación a sandbox en los registros de esta ejecución.

- Conexión OAuth de QA `connected`: vendedor, aplicación y generación coinciden con el intento. Incluye `payments`, `read`, `write` y `urn:mp:online:preference/read-write`; vencimiento posterior al envío.
- Grant APP_USR, descifrado solo en memoria. `/users/me` verifica el vendedor y `test_user`. No se incluye material de autenticación.
- `GET /checkout/preferences/{id}`: HTTP **200**; collector `3594962708`, client_id `2691240967769590`, MLA, ARS, cantidad 1 y precio 100; referencia exacta; `binary_mode=false`, `auto_return=approved`, `expires=true`, vencimiento posterior al envío.
- Webhook: `https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-webhook`. Las tres back_urls usan HTTPS y el host exclusivo QA `recovery-20261020.taba2-staging.pages.dev`: `/pago/resultado`, `/pago/pendiente` y `/pago/error` según resultado.
- `GET /v1/payments/search` con el OAuth del vendedor y esa referencia: HTTP **200**, `paging.total=0`, sin pagos; lectura renovada de solo consulta en `escalamiento-proveedor-verificado.json`.
- Logs del gateway de QA: HTTP 200 al preparar sesión y preferencia. Durante **18:16:19–18:16:34 UTC**, la consulta de `function_edge_logs` no devuelve invocaciones de funciones Mercado Pago de La Taba. El error visible está en el host de Mercado Pago, sin retorno a nuestra página.

**Alcance:** no se halló un desajuste en los campos consultados ni un error de nuestras Edge Functions en la ventana del fallo. Esto no excluye todas las restricciones internas posibles de la relación aplicación–cuenta. Solicitamos confirmación del proveedor antes de declarar una causa raíz.

### Incidentes oficiales

Se consultaron el [estado oficial](https://status.mercadopago.com/) y su API pública el 23/10/2026. Horas de Argentina, UTC−03:00.

| Incidente | Ventana publicada | Correlación |
|---|---|---|
| [ALL SITES — Delay in IPN Payments notifications](https://status.mercadopago.com/incidents/b85h1f8m5nj5) | 23/10/2026 10:19:38.552–10:39:38.657; IPN; resuelto | No coincide en horario. Afecta entrega de notificaciones, no documenta un fallo de creación de pagos en Checkout Pro. |
| [Online Payments — Checkout Pro](https://status.mercadopago.com/incidents/pgzrw2jypzky) | 21/10/2026 22:59:32.003–23:19:31.946; Checkout Pro; resuelto | Mismo componente, distinta fecha y horario. |

Ninguno sustenta atribuirle el error observado. La ausencia de una publicación coincidente no excluye una incidencia no publicada o una restricción específica de la aplicación/cuentas.

### Pregunta técnica concreta pendiente del proveedor

**Para el flow `f134432b-3420-4d6c-b14f-e3d7b1cb72f9`, preference `3594962708-171128df-3092-4de2-96ee-f1f6383efe3d`, aplicación `2691240967769590` y envío `2026-10-23T18:16:19.121Z`, ¿qué operación interna produjo la transición de revisión a `/error/` antes de existir un payment_id?**

Solicitamos:

1. Endpoint, HTTP, código/motivo interno y x-request-id/x-correlation-id de esa operación; correlacionar flow, hora e ID de creación `2974654e-1bb5-4cde-ba43-0b53013914e3`.
2. Confirmar si Checkout Pro marketplace con OAuth del vendedor de prueba está habilitado para esta relación aplicación–vendedor; identificar cualquier restricción concreta de permisos, producto, cuenta o sesión que impida APRO.
3. Si falta configuración, indicar el campo o autorización exactos y la acción requerida. Si es una incidencia interna, indicar su identificador y resolución. Solo entonces se evaluará una nueva prueba.

### Adjuntos aptos para soporte

- `escalamiento-correlacion.json`: IDs persistidos del intento y conexión, sin material protegido.
- `escalamiento-edge-logs.json`: HTTP y request IDs del gateway, delimitados por hora.
- `escalamiento-proveedor-verificado.json`: preferencia y búsqueda de pagos sanitizadas.
- `escalamiento-incidentes-oficiales.json`: componentes, intervalos y actualizaciones oficiales.
- `apro-error-proveedor.png`: captura del error, sin formularios ni datos de tarjeta.

No adjuntar el registro bruto del formulario de compra ni capturas de su carga. Este documento y los adjuntos listados no contienen contraseñas, tokens ni datos de tarjeta.

## Acceso al portal y acción pendiente

Portal oficial: [consultas de soporte técnico](https://www.mercadopago.com.ar/developers/es/support/center/tickets), enlazado desde el centro de soporte. La consulta pública redirige al login de Mercado Pago. El control de la ventana principal de Chrome se detuvo con: «Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy».

No se intentó eludir ese control mediante otro navegador, extracción de sesiones ni llamadas privadas al portal. Se necesita que el titular abra la página de consultas en Chrome y, si el proveedor lo solicita, complete allí el ingreso o verificación. Con el portal visible se podrá retomar el acceso autorizado y verificar si corresponde actualizar `WCS-51579` o registrar un caso nuevo.

El escalamiento solo realizó consultas y conserva el estado financiero de QA. Sin producción, merge, nuevas preferencias, pagos ni cambios de datos financieros.
