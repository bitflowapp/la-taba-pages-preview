# Verificación final de pagos de La Taba — 23/10/2026

> **Actualización, 20:15 UTC:** la causa de este bloqueo quedó encontrada y corregida. La integradora de QA era de una cuenta real; con una de dueño de prueba, APRO aprobó (pago `184722117633`, pedido `LT-0087`). Ver [causa-raiz-20261023/CAUSA-RAIZ.md](causa-raiz-20261023/CAUSA-RAIZ.md). Lo que sigue es el registro de la corrida de las 15:16, tal como quedó.

**Resultado: bloqueado en Checkout Pro. APRO no aprobado.**

Se automatizó Chrome local con una sesión aislada, se recuperó el nickname del comprador desde la API oficial y la contraseña desde Windows Credential Manager, y se envió una sola compra de prueba APRO. No fue necesaria una intervención humana. Después del envío, Mercado Pago mostró «Oh, no, algo anduvo mal» y su API no registró ningún pago para la referencia. No se pulsó Reintentar, ni se generaron preferencias OTHE o CONT.

La causa exacta del fallo de Checkout Pro no está determinada. La frontera del bloqueo está documentada en el host de Mercado Pago, después de la revisión y del único clic en Pagar. No se afirma una caída general ni un defecto confirmado del proveedor. Se preparó [la consulta de soporte](CONSULTA-PROVEEDOR.md), sin enviarla.

## Entorno y preparación comprobados

- Worktree de la rama `fix/mp-oauth-app-usr-credentials-20261023`, HEAD inicial `a6a863ff`, limpio al comenzar.
- Proyecto exclusivo QA: `ixewllzzuzpqrkxzmfzx`, `ACTIVE_HEALTHY`.
- Aplicación: `2691240967769590`; negocio QA A: `7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01`.
- Las ocho Edge Functions corregidas siguen activas; [versiones y configuración JWT](qa-functions.json). No fue necesario redesplegarlas.
- OAuth del vendedor `3594962708`: conexión test operativa, identidad, permisos y binding verificados. El grant descifrado solo en memoria es APP_USR y `/users/me` confirma `test_user` y MLA.
- Comprador `3594962710`: nickname oficial coincide con el registro seguro de su cuenta de prueba; inicio de sesión exitoso usando la contraseña guardada. No se pidieron datos de acceso al usuario.
- La sesión anterior `5f49f59e-ce79-4340-a6f7-5fa52b725cd6` expiró normalmente: reserva liberada por `checkout_expired`, cero pagos, cero pedidos, stock 20.
- El runtime integrado de navegador apuntaba a un archivo inexistente. Se investigó también el catálogo de conectores; no fue necesario instalar ninguno. Se usó el Playwright existente y el Chrome instalado, en un contexto efímero; no se modificó la configuración del navegador personal ni se desactivaron controles del proveedor.

## Intento APRO

Preferencia única creada cuando el comprador ya estaba autenticado: `3594962708-171128df-3092-4de2-96ee-f1f6383efe3d`. Sesión `418a456b-d119-4518-9478-8c286c39d85d`, intent `55136b0c-aa3b-44db-a7bd-b419a8a3af4f`.

Una Mastercard oficial de prueba terminada en 0604, titular APRO y documento de prueba, ARS 100 en una cuota. Envío `2026-10-23T18:16:19.121Z` (15:16:19 Argentina), flujo `f134432b-3420-4d6c-b14f-e3d7b1cb72f9`. El checkout permaneció en `www.mercadopago.com.ar` y terminó en `/error/`.

La preferencia consultada directamente en Mercado Pago confirma collector, aplicación, país, monto, moneda, referencia, URLs y vigencia esperados. La búsqueda oficial con el OAuth del vendedor devuelve cero pagos. [Evidencia de proveedor](apro-provider.json), [resumen de navegador](browser-summary.json), [captura](apro-error-proveedor.png).

El controlador se corrigió durante la preparación para usar el botón accesible del método Contraseña y los campos seguros dentro de iframes. Hubo cambios de contexto antes del envío, que reutilizaron la misma preferencia; no hubo compras adicionales. El registro comprueba exactamente un `pay_submitted` y ninguna presentación OTHE/CONT. La instrumentación inicial no capturó el request ID del envío fallido; ese límite se declara expresamente. Se amplió para una futura ejecución autorizada, sin repetir este pago.

## Corrección local adicional

La invocación manual del worker devolvió 401 aunque el cron respondía 200. Se compararon el secret de Vault y el hash de Edge: estaban alineados. La copia en Windows Credential Manager estaba desactualizada. `qa-mp-worker-key-sync.mjs` recuperó el valor existente de Vault y actualizó únicamente esa copia local, sin rotar secretos remotos. Dos invocaciones posteriores del worker respondieron HTTP 200. Repetir la sincronización comprobó que ya estaba alineada y no hizo cambios.

No hubo cambios de lógica financiera, SQL ni Edge Functions en esta sesión. Las adiciones son herramientas de QA y evidencia. No se tocó producción, no hubo merge ni eliminación de datos.

## Matriz final comprobada

| Control | Resultado y evidencia |
|---|---|
| APRO | Un solo envío. Error de Checkout Pro; cero pagos en la API oficial. No aprobado. |
| OTHE | No ejecutado: depende de APRO aprobado. Ninguna preferencia generada. |
| CONT | No ejecutado: depende de APRO aprobado. Ninguna preferencia generada. |
| Reembolsos | No ejecutados: no existe pago aprobado para reembolsar. |
| Pedidos | Cero nuevos; los seis pedidos QA previos se conservaron. La sesión no tiene pedido. |
| Stock | QA-REC-001: 20 → 19 reservado → 20. Reserva liberada automáticamente el 23/10/2026 a las 15:27:00 Argentina con `checkout_expired`, sin conversión ni venta. |
| Webhooks | Cero recibos nuevos y cero válidos para esta sesión. No se repitieron los seis ensayos falsificados ya confirmados. |
| Conciliación | Cinco trabajos del intent completados, sin último error; cursor del ledger actualizado y cero discrepancias. No certifica un pago aprobado. |
| Idempotencia | Un envío APRO; cero pedidos duplicados. Dos barridos adicionales de vencimiento mantienen el stock en 20 y no liberan otra sesión. Idempotencia de pagos y reembolsos pendiente. |

La sesión final está `expired`, el intent sin `provider_payment_id`, sin pagos, pedidos, recibos, reembolsos ni discrepancias. Evidencia: [estado final](final-session.json), [stock e idempotencia](stock-idempotency.json), [conteos](final-counts.json), [reparación del worker](worker-credential-repair.json). Ventana QA cerrada y Chrome efímero cerrado al finalizar.

## Validaciones y límites

- Comprobaciones de sintaxis de las tres herramientas: correctas.
- Escaneo de secretos: correcto, sin credenciales asignadas ni claves privadas.
- JSON de auditoría legible; aserciones sobre el registro: exactamente un envío APRO y error terminal.
- Dos workers autenticados, sin nuevos pedidos; histórico de notificaciones oficial sin evento de pago para este intento.
- Aprobación, rechazo OTHE, pendiente CONT, webhook de pago válido e idempotencia de pago/reembolso siguen sin certificarse. La ausencia de pagos no demuestra que esos flujos funcionen.

## Documentación oficial consultada

- [Cuentas de prueba de Checkout Pro](https://www.mercadopago.com/developers/es/docs/checkout-pro-preferences/test-accounts).
- [Tarjetas y escenarios de prueba](https://www.mercadopago.com/developers/es/docs/checkout-pro-preferences/test-cards).
- Diagnóstico MCP oficial `notifications_history`, aplicación `2691240967769590`: dos fallos históricos 502, ninguno correlacionado con este intento; no se atribuyeron a APRO.

## Implementation Report

### Verified
- [x] QA y credenciales del vendedor de prueba, navegador local y acceso del comprador.
- [x] Un único envío APRO oficial, error visible del proveedor y búsqueda de pagos vacía.
- [x] Copia local de la clave del worker reparada; dos llamadas HTTP 200.

### Needs attention
- [ ] Diagnóstico del flujo fallido de Checkout Pro por Mercado Pago; consulta preparada, sin enviar.
- [ ] APRO aprobado y su evidencia completa, antes de OTHE, CONT y reembolsos.

### Blockers (must fix before production)
- [ ] No hay una compra APRO aprobada en el flujo OAuth corregido de QA.

### Next steps
1. Obtener diagnóstico del proveedor para el flow ID y la hora documentados, sin reenviar esta compra.
2. Con el bloqueo resuelto y una nueva ejecución autorizada, completar APRO y después OTHE, CONT y reembolsos.

### Resources used
- Codebase y almacén de credenciales de Windows.
- API oficial de Mercado Pago, diagnóstico MCP de notificaciones y herramientas de Supabase sobre QA.
- Guías locales de Mercado Pago, Supabase y descubrimiento de conectores.

**Verdict**: Blocked. No se certificó la integración como terminada.
