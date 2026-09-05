# Continuación por MCP — 5 de septiembre de 2026

Actualización posterior: callback/PKCE y Webhook Secret ya configurados; HMAC remoto verificado. Ver [estado actual](MERCADOPAGO_WEBHOOK_SECRET_VERIFICATION.md). Las secciones siguientes son el registro histórico previo a esa configuración.

El plugin oficial mercadopago 4.3.2 se instaló desde el repositorio de Mercado Pago. Marco autorizó OAuth. El servidor oficial respondió correctamente a initialize, tools/list, application_list y las operaciones siguientes. El transporte OAuth nativo de Codex rechazó los metadatos de autorización; se configuró el cliente mcp-remote 0.8.3 documentado por Mercado Pago, sin desactivar las validaciones de Codex ni modificar el proveedor. La sesión local tiene permisos restringidos al usuario y SYSTEM.

## Aplicación y credenciales

Se reutilizó **TABA2 Staging**, la única aplicación devuelta para el propietario OAuth. No se crearon aplicaciones duplicadas.

- Credenciales de prueba: disponibles vía get_credentials; utilizadas únicamente en memoria.
- Activación: **COMPLETADA** por Marco. Una nueva consulta get_credentials confirmó Client Secret y credenciales de producción disponibles; ya no informa activación pendiente.
- Client ID y Client Secret: **CONFIGURED** en Supabase staging. Se enviaron directamente a Management API en memoria y se verificaron contra las huellas SHA-256 devueltas por el servidor. El token productivo del integrador no se importó al backend.
- Firma de webhook: save_webhook devuelve únicamente los primeros siete caracteres. No sirve para configurar el verificador; el valor completo sigue pendiente.
- La activación requiere términos y reCAPTCHA según la documentación oficial. Marco realizó ese paso; no se aceptaron condiciones legales en su nombre.
- Ninguna credencial real se incluyó en esta documentación, Git, frontend, argumentos CLI ni logs.

El script configurar-oauth-staging.mjs admite ahora JSON por stdin (`clientId`, `clientSecret`, `webhookSecret`), además del prompt PowerShell existente. Un proceso MCP puede enviar esos datos por pipe sin guardarlos en archivos. Rechaza secretos ausentes/truncados e IDs numéricos susceptibles de perder precisión antes de cualquier escritura. No se ejecutó la activación OAuth con valores incompletos.

## Infraestructura y prueba oficial

- save_webhook confirmó ambas URLs en https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook y los tópicos payment y topic_merchant_order_wh. La URL productiva de esta aplicación ya apuntaba a staging y se conservó.
- notifications_history no encontró notificaciones previas. tools/list no expone simulate_webhook; no se inventó una simulación ni se calificó la recepción como verificada.
- create_test_user recuperó los usuarios seller y buyer que ya existían; no creó duplicados. Los datos de acceso se guardaron cifrados con DPAPI del usuario de Windows, fuera del repositorio.
- add_money_test_user confirmó 1000 ARS ficticios para el comprador.
- /users/me confirmó Argentina y la etiqueta test_user del vendedor. Su identidad coincide con el collector histórico de staging: no hace falta sustituirlo ni migrar pedidos.
- La API oficial creó una preference de prueba con HTTP 201 y la consulta posterior respondió 200. Se verificaron collector, external_reference y un init_point de mercadopago.com.ar. No se creó ni pagó una transacción.
- Se eliminó el fallback al host obsoleto sandbox_init_point al devolver una preferencia existente. Los campos históricos permanecen en almacenamiento por compatibilidad.

La prueba de preference confirma la credencial del vendedor de prueba. **No demuestra todavía una autorización seller OAuth de TABA ni un pago Checkout Pro completo.** Esas pruebas siguen pendientes del callback registrado y firma completa.

## Verificación posterior a la activación

- La API de aplicaciones confirmó sitio MLA y aplicación activa, sin bloqueo. El callback de TABA no figura registrado, PKCE está deshabilitado y allow_flow está vacío.
- Se intentó actualizar únicamente callbacks, PKCE y flujos de autorización, conservando los valores anteriores. La operación no se aplicó; la API de Mercado Libre respondió HTTP 403 y la consulta posterior de Mercado Pago confirmó que la configuración seguía igual.
- save_webhook volvió a confirmar las URLs de staging y los tópicos. Su respuesta contiene sólo texto y sigue mostrando únicamente siete caracteres de la clave; no entrega un valor completo en contenido estructurado.
- El verificador remoto ahora encuentra Client ID y Client Secret. Su único secreto pendiente es MERCADOPAGO_OAUTH_WEBHOOK_SECRET y su veredicto permanece DISABLED. No se activó MERCADOPAGO_CREDENTIAL_MODE=oauth.
- Smoke posterior: connect sin sesión 401, webhook sin firma 401, callback sin estado 303 de regreso al panel de staging. Este último resultado verifica la carga de configuración y el rechazo del estado ausente, no una autorización exitosa.
- El navegador controlable disponible es el integrado de Codex; sus pestañas de Mercado Pago siguen en login. La sesión de Chrome usada por Marco no está accesible mediante ese navegador. No se extrajeron cookies ni se intentó acceder a contraseñas.
- Queda pendiente acceso autorizado al panel para registrar el callback exacto con PKCE y obtener la firma completa. No hace falta volver a activar credenciales ni pedir a Marco que copie Client ID o Client Secret.

## Validación de esta continuación

La revisión posterior del ruteo eliminó business_id de la URL de notificación y de las preferences nuevas. La URL definitiva compartida es https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook. Después de HMAC, el receptor busca la conexión por seller, aplicación y entorno, consulta el pago usando OAuth y cruza collector, live_mode y external_reference con el intento del mismo comercio. Un user_id alterado no basta para seleccionar otro comercio ni acreditar pagos. Las URL históricas con business_id siguen siendo aceptadas, pero ese parámetro se ignora.

La base confirmó que el UUID terminado en 0001 es La Taba, con 124 pedidos y 94 intentos, y el runtime público lo usa como negocio predeterminado. Proviene del seed de mayo; no corresponde afirmar que es un UUID no sembrado ni una cuenta de Walter ya autorizada. No tiene conexión OAuth todavía. La configuración de la URL queda desacoplada de ese registro.

Pruebas de ruteo: pagos Node 64/64 PASS; webhook Deno 25/25 y 16/16, Node 12/12 PASS. Incluyen el receptor completo con HMAC, token OAuth cifrado, consulta del pago, rechazo de referencias de otro comercio y falta de firma; la API y las conexiones de esas pruebas son simuladas. La autorización real y la entrega del proveedor continúan pendientes de la configuración manual.

- test:payments: 44/44 PASS, incluidos cuatro rechazos de entradas MCP incompletas sin exponer los valores recibidos.
- test:webhook: Deno 25/25 y 12/12, Node 12/12 PASS.
- npm run check: PASS, incluido secret scan. Se retiraron rutas absolutas de máquina de la documentación anterior para cumplir la higiene de publicación.
- mercadopago-create-preference se desplegó nuevamente sólo en staging tras retirar el fallback de redirección.
- Smoke anterior a la activación: sitio 200, connect sin sesión 401, callback sin configuración completa 503, webhook sin firma 401. El verificador salía con código 1 y DISABLED por tres secretos OAuth pendientes. Los resultados posteriores están arriba; no se presenta ningún bloqueo como PASS.
- codex mcp get confirmó el servidor habilitado con transporte stdio y el cliente oficial recomendado. La autenticación fue comprobada mediante llamadas al servidor, no inferida de la configuración local.
- El frontend no cambió en esta continuación; la evidencia del paquete, responsive y archivos servidos permanece en MERCADOPAGO_OAUTH_VALIDATION.md.

## Checklist oficial recibido

quality_checklist devolvió los siguientes criterios. «Parcial» y «Falta» describen cobertura del criterio; no se presenta un puntaje de homologación. No se ejecutó quality_evaluation porque todavía no se generó un payment_id en esta continuación.

### Campos de implementación

| Criterio API | Estado | Evidencia |
| --- | --- | --- |
| item_quantity | Implementado | _shared/mercadopago.ts:77, cantidades preparadas en SQL |
| item_unit_price | Implementado | _shared/mercadopago.ts:79, precio del servidor |
| statement_descriptor_/_soft_descriptor | Falta | El constructor de preferences no envía descriptor |
| back_urls | Implementado | _shared/mercadopago.ts:103, tres URLs del sitio |
| webhooks_ipn | Parcial | notification_url registrada; firma completa y entrega real pendientes |
| external_reference | Implementado | _shared/mercadopago.ts:101, comprobación remota coincidente |
| email | Falta | La preference no incorpora payer.email |
| payer_first_name | Falta | La preference no incorpora payer.name |
| payer_last_name | Falta | La preference no incorpora payer.surname |
| item_category_id | Falta | No se envía categoría al proveedor |
| item_description | Parcial | _shared/mercadopago.ts:76, opcional según catálogo |
| item_id | Implementado | _shared/mercadopago.ts:74 |
| item_title | Implementado | _shared/mercadopago.ts:75 |
| back_end_sdk | Parcial | REST para cobros; biblioteca oficial para validación de firmas |

### Buenas prácticas

| Criterio API | Estado | Evidencia |
| --- | --- | --- |
| binary_mode | Falta | No se fuerza modo binario; se gestionan estados pendientes |
| date_of_expiration | Parcial | Vencimiento de preference; sin vencimiento específico de ticket |
| marketing_information | Falta | No se envían píxeles publicitarios |
| expiration | Implementado | _shared/mercadopago.ts:109–111 |
| max_installments | Implementado | payment_methods.installments, según configuración |
| modal | Falta | Checkout usa redirección al proveedor |
| logos | Parcial | Identificación textual de Mercado Pago; no se validó sello oficial |
| response_messages | Implementado | Pantallas de resultado/pendiente/error y errores recuperables |
| excluded_payment_methods | Falta | No hay exclusión por método individual |
| excluded_payment_types | Implementado | Exclusión de ticket cuando está deshabilitado |
| shipment_amount | Parcial | Importe de envío incluido como ítem verificado; no campo shipments.cost |
| payment_get_or_search_api | Implementado | Worker y checkout-status consultan el proveedor |
| chargebacks_api | Falta | No hay flujo dedicado de contracargos |
| cancellation_api | Implementado | mercadopago-cancel-payment |
| refunds_api | Implementado | mercadopago-refund |
| settlement | Falta | Sin descarga de reportes de liquidación del proveedor |
| release | Falta | Sin descarga de reportes de todas las transacciones del proveedor |
| address | Falta | No se envía dirección del pagador en la preference |
| payer_identification | Falta | No se envía identificación del pagador |
| payer_phone | Falta | No se envía teléfono del pagador |
| payer_identification_mlm | No aplica | Operación argentina MLA |
| front_end_sdk_pro | No aplica | Redirección directa a init_point, sin modal SDK |

El control local conserva tokens cifrados y permisos server-side, HMAC, URLs HTTPS, precios SQL, referencia e idempotencia y consulta autoritativa de pagos. La credencial del integrador nunca sustituye al vendedor cuando se activa el modo OAuth. Producción de TABA no se modificó y no se realizaron cobros reales.

## Referencias oficiales

- https://www.mercadopago.com.ar/developers/es/docs/mp-plugin/install
- https://github.com/mercadopago/mercadopago-claude-marketplace
- https://www.mercadopago.com.ar/developers/es/docs/mcp-server/mcp-server-troubleshooting
- https://www.mercadopago.com.ar/developers/es/docs/credentials (activación, términos y reCAPTCHA)
- Resultados de tools/list, get_credentials, save_webhook, create_test_user, add_money_test_user y quality_checklist del servidor https://mcp.mercadopago.com/mcp.
