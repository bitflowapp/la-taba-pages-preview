# Ejecución real de R-MKT-1 — 30/10/2026

Estado más reciente: [misión autónoma OAuth/Moto G15](../oauth-night-20261030/INFORME.md). A confirmado en Developers; B sigue desconectado, sin compra ni certificación R-MKT-1. Los enlaces de intentos anteriores no se reutilizan.

Inicio: 05:42 UTC (02:42 de Argentina). Base: PR #161, `f7f1f45c0de2045e6546290c486a97c976686dab`, sin cambios de código; CI tools y financial_sql verdes. No se repitieron las auditorías/suites certificadas.

## Preparación de OAuth

- `verificar-configuracion.mjs --ref=qa`: salida 0, veredicto TEST, nueve funciones activas.
- `qa-mp-marketplace.mjs preflight --seller 3796774164`: sin blockers técnicos; integradora TestApp `4861627125869370`, dueña de prueba `3594962708`, comercios A/B cerrados. B existe con un producto y sigue desconectado.
- Vendedor B existente previsto: `3796774164`, distinto de A y de la dueña. No se creó otra cuenta ni se solicitó/almacenó su contraseña.
- `qa-mp-e2e.mjs connect-url --tenant b`: salida 0. El handler real emitió un enlace con host oficial, aplicación de QA, callback exacto de `ixewllzzuzpqrkxzmfzx`, state de un uso y PKCE S256; vigencia diez minutos. Alcance declarado: `read write offline_access`.
- El enlace y sus parámetros de sesión se entregan sólo en el chat, nunca en este documento. Generarlo registra sesión/estado OAuth en QA; no constituye consentimiento, vinculación ni pago.

## Pendientes, sin simular

| Etapa | Estado |
|---|---|
| Preparación técnica OAuth QA | GO para presentar el consentimiento |
| Consentimiento del titular B | PENDIENTE de acción en su navegador |
| Identidad/grant después del consentimiento | PENDIENTE de verificación del servidor |
| Compra APRO manual ARS 100 | NO PREPARADA todavía; esperar vinculación verificada |
| R-MKT-1 real, stock, pedido, webhook, conciliación y replays | NO CERTIFICADO todavía |
| Devolución por API | Sin nueva evidencia; no certificada |
| Producción, vinculación Walter y apertura | NO-GO; sin autorización ni modificaciones productivas |

Siguiente paso: titular B confirma que está usando su cuenta de prueba existente, abre el enlace oficial y pulsa Autorizar. No debe enviar contraseñas, códigos ni la URL de retorno. Tras su aviso se verifica el grant y recién entonces se prepara APRO. No se envió ningún enlace a Walter.

## Bloqueo observado por el titular

El enlace emitido a las 05:42 UTC no llegó a mostrar consentimiento: Mercado Pago mostró «La aplicación no está preparada para conectarse a Mercado Pago», en `auth.mercadopago.com.ar/appstore/access`. **La emisión y validación de parámetros del enlace no prueban la aceptación del proveedor.** B sigue sin certificarse; no reutilizar ese enlace. El diagnóstico acotado y los pasos de revisión del titular están en [DIAGNOSTICO-OAUTH.md](DIAGNOSTICO-OAUTH.md).
