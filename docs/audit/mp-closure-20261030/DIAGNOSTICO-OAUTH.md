# Bloqueo OAuth TestApp — 30/10/2026

**NO-GO de consentimiento hasta revisar la configuración de la aplicación.** El usuario reportó «La aplicación no está preparada para conectarse a Mercado Pago» en `/appstore/access`, sin llegar al consentimiento B. No se corrigió externamente ningún ajuste y no se generó otro enlace de conexión.

Alcance exclusivo: identidad de aplicación/vendedor, registro OAuth y parámetros. Sin auditorías generales, nuevas cuentas, pagos, renovación de credenciales, producción, cambios de permisos ni despliegues. La API de aplicación puede devolver tokens: se seleccionaron campos de configuración seguros antes de imprimir o guardar; ningún token ni secreto está en la evidencia.

## Comparación exacta

Lectura autenticada con el token técnico existente de QA: `GET /applications/4861627125869370`, HTTP 200 a las 05:47:55Z, request ID `1e56c926-4fbb-486b-8524-ec5ee4450f58`. Evidencia: [configuracion.json](evidencia-oauth/configuracion.json).

| Comprobación | Resultado |
|---|---|
| Client ID y nombre | `4861627125869370`, `TestApp-ae01fd1d`, descripción de aplicación automática de prueba; sitio MLA. Correcta. |
| Estado | `active:true`, `blocked:false`, `disabled:false`, `sandbox_mode:true`. Esto no demuestra que esté habilitada para autorizar vendedores terceros. |
| Dueño y B | `/users/me` = `3594962708`, cuenta de prueba; `/users/3796774164` = B, MLA/AR y distinto. No prueba qué sesión eligió el navegador del usuario. |
| Callback enviado por el código/enlace | `https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback` |
| Callback principal publicado por API | `https://ucbtjcurawxjwjdvvcvj.supabase.co/functions/v1/mercadopago-oauth-callback` — backend retirado. **No coincide con el enviado.** |
| Lista `callback_urls` | Contiene el callback retirado y el de QA actual; **el actual coincide exactamente**, sin query ni barra final. No afirmar que falta el callback de QA. |
| Scopes | `read`, `write`, `offline_access` presentes en la aplicación y solicitados por la URL. No hay evidencia de que su ausencia cause este rechazo. |
| PKCE | `use_pkce:true` en la aplicación. Código: verifier aleatorio de 32 bytes/base64url (43 caracteres), challenge SHA-256/base64url y `code_challenge_method=S256`; callback envía `code_verifier`. Compatible con el contrato documentado. |
| Authorization code / Marketplace | `allow_flow:[]`, `catalog_product_id:null`, `usage_profile:null`. No hay documentación suficiente para interpretar esos valores como prohibición ni habilitación; **no confirmado**. Revisar el modelo/flujo visible para el dueño en Developers. |

El enlace anterior también llevaba `response_type=code`, `platform_id=mp`, state aleatorio y el Client ID correcto. El mensaje aparece en el sitio de Mercado Pago antes del retorno informado por el usuario: todavía no hay evidencia de una falla de intercambio de código o de guardado del grant en Supabase.

Dos sondas GET anónimas, sin sesión de vendedor ni consentimiento, compararon autorización con y sin scope explícito. Ambas devolvieron 302 al login oficial, sin error inmediato. No usaron el enlace entregado ni generaron estados utilizables en La Taba; sus parámetros efímeros no se guardaron. [Evidencia](evidencia-oauth/sondas-sin-sesion.json). **Llegar al login no prueba aceptación después del login**: no se puede descartar una restricción de la TestApp ni confirmar una causa única con esas sondas.

## Diagnóstico y siguiente acción

Hay una inconsistencia concreta en la configuración externa: callback principal de un backend retirado frente al QA actual. La lista incluye la URL correcta, de modo que **no está probado que esa diferencia por sí sola produzca el mensaje**. Tampoco está comprobada la habilitación del flujo de autorización a terceros. No se modifica código, se desactiva PKCE ni se quitan scopes a ciegas.

El dueño debe abrir [Developers → Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app), identificar **TestApp-ae01fd1d, ID 4861627125869370**, y entrar en **Editar aplicación → Configuración avanzada**. Si no aparece esa TestApp o no ofrece edición, informar esa limitación; no editar La Taba Delivery ni una aplicación productiva o padre por sustitución.

Revisión concreta antes de guardar:

1. Identificar el campo principal **Redirect URL / URLs de redireccionamiento**. El ajuste propuesto es dejar como principal exactamente `https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback`, para alinear la integradora de QA con su backend vigente. No cambiar Client ID, Client Secret ni otras credenciales. El cambio externo lo realiza el dueño o se ejecuta sólo después de autorización explícita; este diagnóstico no lo aplicó.
2. Confirmar si el panel muestra el modelo **Marketplace** y permite el flujo de **código de autorización** para conectar otras cuentas. Informar lo que muestra; no inventar una opción ni crear otra aplicación si la TestApp no lo permite. No se cambia de API: el código existente utiliza Checkout Pro con Preferences.
3. Mantener PKCE activado y conservar `read`, `write`, `offline_access`, que ya coinciden. No regenerar secretos ni tocar la configuración de producción.

Tras el aviso del titular se relee la API para comprobar lo guardado. Si sigue sin poder confirmarse la autorización de terceros o el proveedor sigue rechazando, mantener NO-GO y preparar consulta de soporte con App ID, request IDs y configuración saneada, sin credenciales. No atribuir semántica no documentada a `allow_flow:[]`.

**Sólo después de resolver/revalidar la configuración** se generará un enlace QA nuevo mediante el handler real, con state y PKCE nuevos, diez minutos y un uso. No se reutiliza el anterior. El paso se aprueba cuando Mercado Pago muestra consentimiento y luego el servidor verifica el grant de B; ni este diagnóstico ni un enlace bien formado sustituyen esa evidencia.

## Fuentes primarias

- [OAuth: código de autorización y PKCE](https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation).
- [OAuth: coincidencia exacta de la Redirect URL](https://www.mercadopago.com.ar/developers/es/docs/security/oauth/best-practices).
- [Marketplace: configuración y Redirect URL](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/create-configuration).
- [Developers: edición y configuración avanzada](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/application-details).
- Código local: `_shared/seller-oauth-crypto.ts`, callback OAuth y helper QA; lecturas saneadas de API adjuntas. No se usó una inferencia de terceros como prueba de causa raíz.
