# Pre-Walter gate y pasos presenciales — 2026-09-05

## Resultado comprobado

El negocio `3537d949-d76b-410d-be89-e4f447546e29` tiene **0 conexiones OAuth, 0 seller IDs, 0 tokens seller asociados, 0 estados OAuth y 0 pagos**. No existe configuración financiera heredada. El estado real de `mercadopago-connect` es `disconnected`, `seller_id=null`, `connected_at=null`, HTTP 200. No hubo asociación de Marco que revocar.

La aplicación integradora `2691240967769590`, **TABA2 Staging**, sigue visible mediante el MCP de su propietario Marco/LUNA. Los secrets Client ID, Client Secret, clave de cifrado y Webhook Secret siguen configurados server-side. No se recuperaron sus valores ni se modificó la aplicación, sus permisos, callback, PKCE o webhook. El modo de credenciales continúa en OAuth: las credenciales de plataforma no sustituyen una conexión seller.

**Diagnóstico:** A queda descartado. En el panel publicado no se reprodujo B: la API no entrega datos de la aplicación como seller y la tarjeta no muestra Marco/LUNA. No se pudo inspeccionar la sesión original del usuario, por lo que C no se presenta como causa confirmada. La sesión del proveedor o su panel Developers puede mostrar la cuenta integradora; el indicador general «Conectado» de TABA tampoco representa una conexión Mercado Pago.

Se hizo explícito **No conectado** en la tarjeta Mercado Pago y se publicó el service worker `la-taba-runtime-v97-explicit-seller-status`. Despliegue staging: `bacbcee1`; sus 178 archivos coinciden con el paquete. El runtime conserva el ID nuevo y `Cache-Control: no-store`.

## Gate ejecutado

- Base y API reales: cero conexiones y tokens de seller antes y después; histórico legacy de 94 intents y 184 eventos intacto.
- Navegador limpio: tarjeta «No conectado», botón disponible, ningún nombre de propietario de aplicación presentado como seller. Se inyectó el UUID legacy en localStorage: ninguna solicitud salió hacia ese negocio.
- Clic real en el botón del sitio publicado: Edge Function 200, URL de autorización de TABA2 Staging, callback correcto, PKCE S256 y scopes `read write offline_access`.
- Se comprobó en DB que el hash del estado correspondía a Walter, al usuario que inició el intento y al entorno de consentimiento `production`; el verifier estaba cifrado. La URL real del proveedor respondió 302 hacia su login en `www.mercadolibre.com`.
- No se inició sesión ni se consintió con ninguna cuenta Mercado Pago. Se canceló el intento por callback: 303. Repetirlo produjo error: replay bloqueado.
- La identidad temporal de TABA, el estado y la fila vacía creada por el intento fueron eliminados. La eliminación se restringió a su generación, sin seller, sin tokens y sin pagos. No se crearon usuarios de prueba de Mercado Pago.
- Pruebas pertinentes: 20/20 Node; 2/2 Playwright (320 y 1280 px). La prueba incorpora metadatos de plataforma Marco/LUNA y verifica que no aparezcan en la tarjeta. `npm run check`, preflight, escaneo de secrets y verificación publicada PASS. La lógica de backend no cambió y no necesitó redeploy.

La evidencia técnica está fuera de Git en los archivos `la-taba-prewalter-live-evidence.json`, `la-taba-walter-final-evidence.json`, `la-taba-prewalter-panel.png` y los logs de validación de esta fase. La sesión de autorización real de Walter sigue pendiente. Los cobros reales siguen deshabilitados.

## Mañana: pasos literales

### Antes

1. Usá tu notebook y tené a Walter presente con su celular para validar el ingreso. Comenzá y terminá el flujo en el mismo navegador.
2. Para aislar cuentas, usá una ventana nueva de incógnito y no inicies Mercado Pago con Marco allí. Si usás una ventana normal, cerrá primero las sesiones de Mercado Pago y Mercado Libre de Marco. No cierres la sesión de TABA a mitad del proceso.
3. Abrí <https://taba2-staging.pages.dev/#business>. Ingresá con el usuario de TABA ya habilitado como Dueño o Encargado de este negocio; no crees un usuario nuevo para esta autorización.
4. Confirmá el título **TABA Walter Staging**, **Panel del negocio** y el rol **Dueño** o **Encargado**. Ese sitio está fijado al business `3537d949-d76b-410d-be89-e4f447546e29`.

### Marco

1. En la barra del panel, tocá **Pagos**.
2. Dentro de la tarjeta **Mercado Pago**, comprobá **No conectado**.
3. Tocá **Conectar Mercado Pago** una sola vez y entregale el control de la notebook a Walter.

### Walter

1. En el login de Mercado Pago —puede pasar por Mercado Libre— ingresá con **tu propia cuenta receptora** y completá en privado cualquier validación de seguridad. Si aparece Marco/LUNA como cuenta con la que vas a continuar, detenete y cambiá de cuenta.
2. En el consentimiento, verificá que la aplicación sea **TABA2 Staging** y que la cuenta autorizante sea la tuya. El permiso solicitado incluye lectura, escritura y acceso continuado: `read`, `write`, `offline_access`, según el [contrato OAuth del proveedor](https://www.mercadopago.com.ar/developers/es/reference/authentication/oauth/_oauth_token/post).
3. Confirmá la autorización de TABA2 Staging con el botón de aprobación de esa pantalla. No se observó la pantalla autenticada, por lo que no se certifica su etiqueta literal; Mercado Pago controla esa interfaz.
4. Esperá el regreso automático a <https://taba2-staging.pages.dev/?mp_connection=connected#business>. No copies la URL intermedia, el código OAuth, contraseñas, códigos de verificación ni tokens. Walter introduce sus credenciales directamente; Marco no necesita verlas, recibirlas ni guardarlas.

### Resultado esperado

La tarjeta **Mercado Pago** muestra **✓ Mercado Pago conectado correctamente**, el identificador de la cuenta receptora y los botones **Verificar conexión** y **Desconectar**. No efectúen ningún pago todavía: primero ejecuten el gate posterior.

## Si se autorizó una cuenta equivocada

1. No creen preferences ni pagos. En TABA → Pagos → Mercado Pago, tocá **Desconectar** y aceptá la confirmación. Esto elimina los tokens locales y pausa pagos; conserva el seller ID como protección. No equivale a borrar la aplicación ni a revocar automáticamente el permiso en el proveedor.
2. Pegá en Codex: «Se autorizó por error la cuenta de Marco en el business 3537d949-d76b-410d-be89-e4f447546e29. Ya la desconecté. Verificá que no existan pagos, preferences, intentos ni eventos financieros vinculados. Si sigue sin historial, revocá únicamente la autorización equivocada si el proveedor lo permite y restablecé este business a cero conexiones y estados OAuth. Conservá TABA2 Staging, sus secrets, callback, PKCE, webhook, todas las guardas y el negocio legacy. No borres historia. Si existe historial, detené el restablecimiento y explicá el bloqueo concreto.»
3. Esperá la comprobación de **0 conexiones / disconnected**. No intentes cambiar de seller directamente: la guarda lo bloquea. Cerrá la ventana de autorización equivocada y empezá de nuevo con Walter desde una ventana limpia.

## Prompt para después de autorizar Walter

```text
Walter acaba de autorizar Mercado Pago en TABA staging. Continuá en C:\1212\la-taba-mercadopago-oauth sobre el business 3537d949-d76b-410d-be89-e4f447546e29 y el proyecto Supabase ukxqbgswjlibmnjemrzd. Verificá callback y logs, business del estado consumido, identidad del seller en la API y coincidencia con la cuenta que Walter acaba de confirmar; no deduzcas que es Walter solo porque no es Marco o porque aparece conectado. Comprobá tokens cifrados, presencia y vigencia del refresh token sin mostrarlo, protección seller_change_requires_migration con fixtures aislados, routing y HMAC del webhook, panel publicado y ausencia de secrets en Git y frontend. Conservá el historial legacy. Determiná la readiness para el primer pago e indicá cualquier gate pendiente: autorizar OAuth no habilita automáticamente cobros productivos. No hagas pagos reales, no habilites cobros ni cambies el seller automáticamente. No pidas ni muestres contraseñas, códigos ni tokens.
```
