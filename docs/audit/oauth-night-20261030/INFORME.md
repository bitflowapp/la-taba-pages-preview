# Misión autónoma OAuth y Moto G15 — 30/10/2026

**Resultado: OAuth de B todavía NO desbloqueado ni certificado.** Se confirmó al propietario con una sesión real de Developers y se completó la revisión de su aplicación. El impedimento para comprobar el rechazo como B es ahora concreto: no hay acceso de B en el almacén autorizado y Developers impide consultar/administrar cuentas de prueba desde el perfil A. No se sorteó esa restricción ni se modificó configuración sin una prueba que justificara el cambio.

Rama `fix/qa-oauth-provider-20261030`, partiendo de `96a38cb1`. El diagnóstico local existía, estaba confirmado y no había cambios ajenos. El código de pagos es el de #161, `f7f1f45c`; la misión no modifica runtime, migraciones ni pruebas. No se repiten las auditorías generales certificadas.

## 1. Causa del rechazo: hechos e hipótesis

El mensaje observado por el usuario, «La aplicación no está preparada para conectarse a Mercado Pago», sigue sin una causa raíz única demostrada. No hubo una sesión autorizada de B en esta ejecución, así que **no se presenta una llegada al login, un enlace bien formado ni la configuración local como prueba de aceptación del proveedor**.

| Hecho comprobado | Conclusión permitida |
|---|---|
| TestApp aparece al iniciar sesión como A; el detalle muestra User ID `3594962708` y App ID `4861627125869370` | El propietario es A. Su ausencia en la cuenta personal Marco Antonio no implica que la app no exista. |
| La tarjeta del panel dice «Integración para tu cuenta»; la edición muestra Checkout Pro / API de Preferencias | Hay una aplicación real accesible, pero esa pantalla no demuestra habilitación de Marketplace para vendedores terceros. No se observó una opción editable Marketplace/Authorization Code. |
| PKCE Sí, read/offline access/write marcados, igual que la API | No hay evidencia para desactivar PKCE o cambiar permisos. Se conservan. |
| Callback actual de QA presente exactamente en `callback_urls`; principal aún apunta al backend retirado | Existe una inconsistencia de metadatos, **no una prueba de que falte la URL ni de que cambiar la principal arregle el error**. No se quitó ni cambió ninguna URL. |
| `allow_flow:[]`, aplicación activa y no bloqueada | No se atribuye una semántica no documentada al array vacío. Activa no significa OAuth de terceros confirmado. |
| B público existe en MLA/AR y difiere de A | Identidad y país confirmados; falta sesión/grant de B para verificar su cuenta y aceptación efectiva. |
| No sabemos qué identidad efectiva usó el navegador en el intento fallido anterior | Una sesión distinta de B o una restricción de la app son hipótesis; ninguna se declara causa confirmada. |

No se encontró un defecto nuevo del código de autorización que justificara un parche o un despliegue. No se desactivaron controles ni se hizo un experimento externo con callbacks sin poder medir luego el resultado como B.

## 2. Propietario y revisión real de Developers

Se usó exclusivamente el login **existente** de `RECOVERY MP TEST SELLER`, leído del Credential Manager a memoria. Antes de usarlo se contrastó `/users/me`: `3594962708`, MLA, etiqueta `test_user`. Chrome se abrió en un contexto aislado, sin importar cookies ni sesiones personales.

El login con contraseña de prueba fue aceptado. No hubo CAPTCHA que resolver, OTP, biometría ni rechazo de contraseña. No se accedió con la cuenta real de Marco ni se intentaron otras cuentas indiscriminadamente. El panel listado y el detalle de la app confirmaron TestApp; la revisión de edición no guardó cambios.

Se verificó visualmente en el formulario:

- Pagos online, Checkout Pro y API de Preferencias seleccionados.
- Las dos Redirect URLs registradas, conservadas.
- PKCE activado.
- `read`, `offline access` y `write` seleccionados.
- Ningún selector visible de Marketplace/Authorization Code en esa pantalla.

La evidencia pública es un resumen estructurado y saneado del panel y de la API, no un volcado de credenciales ni una captura de la cuenta. Los accesos técnicos existentes no se regeneraron ni se guardaron de nuevo. Al terminar se cerraron los contextos aislados de Chrome.

## 3. Intervención humana imprescindible

Al abrir **Cuentas de prueba** de la TestApp desde A, Mercado Pago mostró un modal: **«No es posible crear cuentas de prueba desde este perfil»**. Indicó volver a la cuenta principal. Se leyó sólo ese aviso, no se cerró para extraer información oculta ni se consultaron endpoints internos para sortearlo.

El almacén autorizado contiene A y el comprador QA, pero no B. Por tanto, no se puede iniciar una sesión legítima de B y comprobar la pantalla de consentimiento mientras el titular duerme. La documentación oficial también explica que los perfiles de prueba tienen restricciones administrativas. Eso **no demuestra por sí mismo** que TestApp tenga prohibido el OAuth: es el límite de acceso encontrado en esta misión.

Los pasos mínimos para mañana están en [MANANA.md](MANANA.md). Si el titular tiene el acceso B, se utiliza exclusivamente en su navegador o se lee del mecanismo oficial autorizado a memoria: no se envían contraseñas ni códigos al chat. Si no lo tiene, debe consultar los datos de esa cuenta de prueba desde su cuenta principal en Developers. No se crea otra cuenta ni se usa la reserva para sustituir silenciosamente a B.

## 4. Cambios y reversión

**Configuración externa: cero cambios.** No se aplicó el cambio de callback principal, no se borraron URLs, no se modificó el modelo de integración ni los permisos, no se renovaron credenciales y no se activó producción.

Se conservaron los valores anteriores efectivos en `evidencia/configuracion-efectiva.json`. Si una prueba posterior demuestra necesario reordenar callbacks, antes de guardar hay que preservar las dos URLs y anotar la lista y principal anteriores; la reversión restaura exactamente esos campos, sin tocar scopes, PKCE, otras aplicaciones ni secretos. No se propone cambiar `allow_flow` por una API no documentada.

Los únicos cambios del repositorio son documentación y evidencia saneada. Los controladores temporales de diagnóstico están ignorados en `artifacts/ci`; no forman parte de la aplicación publicada ni se necesita instalarlos en producción.

## 5. B y APRO preparados sin ejecutar una compra

Lectura de QA a las 06:23:20 UTC:

| Dato | Valor |
|---|---|
| Proyecto | `ixewllzzuzpqrkxzmfzx`, entorno de prueba |
| Comercio B | `7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a02`, `qa_fixture:true`, **closed** |
| Conexión B | **disconnected**, sin seller/application guardados |
| Producto | `QA-MKT-001`, id `8aba920f-f1b3-4590-b30b-7d7b4447f716` |
| Precio / cantidad prevista | ARS 100 × 1; retiro, sin alcohol |
| Stock | 5; disponible, activo, precio confirmado |
| Pedidos / intenciones B | 0 / 0 |
| Comprador previsto | Cuenta de prueba existente `3594962710`, distinta de A/B |
| Operaciones creadas esta misión | Ningún checkout, preferencia, pago ni devolución |

La ficha y comandos están preparados; no existe un checkout de cobro dejado abierto durante la noche. Se tomará una baseline v2 nueva justo antes de la compra, cuando B esté conectado y la persona compradora esté presente. La ventana de QA no se abrió.

**R-MKT-1 sigue sin certificar.** Faltan consentimiento B, APRO manual aprobado y después pedido/stock exactos, aviso original del proveedor, cuatro replays firmados, aislamiento y conciliación. La secuencia revisada de #161 está en [PREFLIGHT.md](../mp-closure-20261030/PREFLIGHT.md). Un replay no es un webhook original observado. Una devolución externa no certifica la API de devoluciones; no hay evidencia nueva de ésta.

## 6. Moto G15

ADB detectó **moto g15**, estado `device` autorizado. Se verificaron modelo, disponibilidad de Chrome y metadatos de bloqueo/actividad. La pantalla no estaba bloqueada y la actividad en primer plano era ajena a esta prueba; **no se leyó su contenido**.

No hizo falta usar el teléfono para autenticación: A pudo iniciar sesión en la PC sin código. No se abrieron notificaciones, mensajes, fotos, apps financieras ni información personal. No se hicieron capturas del teléfono, no se instalaron apps y no se cambiaron configuraciones. No se afirma haber probado OAuth de B en Android.

## 7. Producción y Walter

El registro permanece `production.status=not_provisioned`, sin ref productivo de La Taba. No se crearon recursos ni se consultaron o modificaron proyectos ajenos. El plan actualizado, con costos verificados el 30/10 y fases de autorización, está en [WALTER-PRODUCCION.md](WALTER-PRODUCCION.md).

No se conectó a Walter, no se le envió enlace y no se habilitaron cobros reales o públicos. Su OAuth se prepara sólo después de autorizar y verificar el backend productivo; el candado de compra controlada y la llave final siguen siendo decisiones separadas.

## 8. Verificación y evidencia

| Resultado | Evidencia |
|---|---|
| Dueño, app en panel y formulario real | `evidencia/panel-propietario.json` |
| Configuración efectiva y valores conservados | `evidencia/configuracion-efectiva.json` |
| B cerrado y ficha de compra sin operación creada | `evidencia/b-preparacion-sin-pago.json` |
| Conexión autorizada del dispositivo y límites de uso | `evidencia/dispositivo.json` |
| Integridad | `evidencia/MANIFEST.sha256` |

No se ejecutaron de nuevo suites financieras, de navegador ni emuladores: no cambió el código certificado. Continúa siendo evidencia del código la [CI de #161](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/41009499965): 119 SQL, herramientas sin fallas. Esa CI no certifica un consentimiento de Mercado Pago. Para los documentos nuevos se revisaron secretos, diferencias y hashes.

## 9. Veredicto por etapa

| Etapa | Estado |
|---|---|
| Código certificado de #161 y preparación de datos QA | **GO técnico**, evidencia reutilizada sin repetir auditorías |
| Identidad del propietario y acceso real a TestApp | **GO técnico**, A confirmado por API y Developers |
| Aceptación OAuth real como B | **PENDIENTE HUMANO / NO VERIFICADO**; no se declara corregido el error |
| Vinculación B | **PENDIENTE HUMANO**, desconectado |
| R-MKT-1 | **NO CERTIFICADO**, falta APRO y evidencia posterior |
| Piloto real y apertura comercial | **NO-GO**, sin producción autorizada ni certificación real |

## 10. Fuentes

- [OAuth y PKCE](https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation), [configuración Marketplace](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/create-configuration).
- [Cuentas de prueba y restricciones del perfil](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/resources/test-accounts), [cuentas de prueba para Marketplace](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/additional-content/your-integrations/test/accounts).
- API oficial autenticada de QA y la sesión aislada del propietario en Developers. No se enviaron consultas de soporte ni mensajes externos; se dejó una [consulta preparada](CONSULTA-SOPORTE.md).
