# Pantalla de retorno del pago: dos defectos y su prueba de navegador — 25/10/2026

Rama `feature/taba-commercial-payments-final-20261025` (PR #156). Cambio mínimo de cliente; sin migraciones, sin
tocar el diseño v167. Caché del service worker `la-taba-runtime-v168-pago-retorno` (el digest del precache cambió y la
identidad de release lo exige).

## Por qué

El retorno de Mercado Pago (`/pago/resultado/`) sólo se probaba por HTTP en el banco de cobros y con pruebas de unidad de
`paymentStatusPresentation`. En un navegador no había nada. Al escribir la prueba aparecieron dos defectos, ambos
reproducidos antes de corregir (2 de 8 casos en rojo sobre el código anterior).

| | Defecto | Consecuencia | Corrección |
|---|---|---|---|
| **R-1** | Un pago **rechazado** deja la sesión abierta a propósito (reserva activa, se puede reintentar con otro medio): el servidor informa `status: payment_pending` junto a `payment_status: rejected` (evidencia del banco, `rejected_then_approved`: `session: payment_pending`, `intent: rejected`). `paymentStatusPresentation` evaluaba la sesión abierta **antes** que el rechazo | quien volvía con la tarjeta rechazada leía **«Pago pendiente — seguiremos escuchando la confirmación de Mercado Pago»** y la pantalla consultaba 60 s | el rechazo gana sobre la sesión abierta; estado terminal «Pago rechazado» con un texto que dice que el carrito sigue y que puede reintentar |
| **R-2** | El combo viaja al servidor por identificador, pero el estado del checkout lo devuelve **ya expandido a productos**. Al confirmarse el pedido, el retorno solo descontaba productos | el combo pagado **seguía en el carrito** tras «Pedido confirmado»: un segundo toque en «Confirmar» lo cobraba otra vez | el checkout guarda en el registro de recuperación (local, sólo `comboId` y cantidad, validados) los combos que viajaron; al confirmarse salen por identificador. Un combo agregado después se conserva |

## Prueba nueva

`tests/e2e/pago-retorno-estados.spec.mjs` (Chromium y WebKit móvil; backend de mentira, sin dinero):
la URL `?status=approved` no confirma nada (manda el servidor), pendiente→aprobado sin recargar, rechazado, revisión
manual, servidor caído (sigue «Verificando», se recupera), sin conexión (y vuelve la red), sin sesión guardada en ese
navegador (no inventa un pedido), y el combo pagado. Más 2 pruebas de unidad (estado y registro de recuperación).

Corridas: 8/8 en Chromium y 8/8 en WebKit móvil; 28/28 con los specs vecinos (handoff, navegación de vuelta, cliente
nuevo); 363/363 de las pruebas Node relacionadas; `npm run check` verde.

## Reembolso por API: investigación del 25/10 (sin hallazgos nuevos)

Se volvió a buscar en la documentación oficial (Checkout Pro «Reembolsos y cancelaciones», Argentina) y en foros
públicos. La página oficial **no documenta** cómo probar reembolsos con usuarios o credenciales de prueba, ni
restricciones del entorno de prueba, ni los errores del endpoint. El 401 «Unauthorized use of live credentials»
(code 7) aparece en foros asociado a usuarios de prueba con credenciales de producción en pagos por API y a
reembolsos con credenciales no coincidentes, sin una explicación oficial para Checkout Pro con OAuth. No hay una vía
oficial que no se haya probado (token OAuth del vendedor, token directo de la TestApp y devolución desde la cuenta del
vendedor ya están medidos en `REEMBOLSO-401.md` y `REEMBOLSOS-API.md`). **Sigue siendo una limitación del proveedor**:
la consulta a soporte (texto en `REEMBOLSO-401.md` §6) la envía el titular de la cuenta, y la API se certifica con el
primer reembolso real de control; la devolución desde la cuenta del vendedor queda conciliada como respaldo.

El plugin oficial de Mercado Pago para Claude Code aparece ahora disponible en esta sesión, pero **no está autorizado**:
autorizarlo es una acción del titular (E7 del README).
