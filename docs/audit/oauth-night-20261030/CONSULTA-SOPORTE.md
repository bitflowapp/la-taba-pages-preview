# Consulta preparada para soporte de Mercado Pago — no enviada

Usar sólo si persiste el rechazo con una sesión confirmada de B o si el panel no permite habilitar OAuth de terceros. No enviar secretos, códigos, URLs de autorización completas, cookies ni capturas de credenciales. El envío requiere la acción/autorización del titular; esta misión no contactó a nadie.

**Asunto:** OAuth de vendedor tercero en TestApp: aplicación no preparada pese a callback, PKCE y scopes presentes.

Estamos validando Checkout Pro / Preferences con una aplicación de prueba existente:

- TestApp-ae01fd1d, App ID `4861627125869370`, sitio MLA.
- Dueño confirmado por API y por Developers: usuario de prueba A `3594962708`.
- Vendedor previsto: usuario B `3796774164`, distinto de A; comprador de prueba `3594962710`.
- Error reportado al abrir OAuth: «La aplicación no está preparada para conectarse a Mercado Pago», en `/appstore/access`, antes del consentimiento.
- Callback enviado y presente exactamente en `callback_urls`: `https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback`.
- La principal `callback_url` todavía es la del backend retirado `ucbtjcurawxjwjdvvcvj`; no se ha modificado para no asumir que sea la causa.
- `use_pkce:true`, código S256, `read`, `write`, `offline_access` presentes y marcados en Developers. Aplicación activa, no bloqueada ni deshabilitada.
- La API devuelve `allow_flow:[]`, `catalog_product_id:null`, `usage_profile:null`. No inferimos su semántica.
- El panel la presenta como integración para la propia cuenta; la edición no muestra un selector Marketplace/Authorization Code.

Solicitamos confirmar:

1. ¿Puede esta TestApp automática, cuyo dueño es una cuenta de prueba vendedora, autorizar a un vendedor de prueba distinto por Authorization Code y operar como integradora Marketplace?
2. ¿La política de OAuth utiliza `callback_urls`, `callback_url` o ambas para esta clase de aplicación? ¿Qué condición exacta causa el mensaje?
3. ¿Qué significa `allow_flow:[]` en este recurso y qué ajuste soportado, si alguno, habilita la autorización de terceros sin crear otra aplicación ni modificar credenciales?
4. ¿Existe una restricción de tipo de cuenta/aplicación o un requisito de habilitación que no aparezca en el formulario de edición?

Referencia saneada del recurso: `GET /applications/4861627125869370`, request ID `1e00bc65-203b-4153-8db1-e2f3d1f0df15`, 30/10/2026 06:10:46 UTC. El request ID es de la lectura de configuración, **no del intento fallido del navegador**. Completar la hora y request/correlation ID del rechazo efectivo cuando una persona lo reproduzca con B.

No se movió dinero, no se creó una cuenta nueva y no se tocó la aplicación productiva. Adjuntar sólo `configuracion-efectiva.json` y el resumen saneado del formulario si son necesarios.

## Actualización para incluir en la consulta — 30/10/2026 17:32 UTC

El titular informó además este segundo mensaje: **«La aplicación no puede conectarse a tu cuenta. Esta aplicación solicita acceso a información que, por seguridad, no podemos compartir»**. Necesitamos la regla/recurso/scope exactos que generan ambos mensajes, no una recomendación genérica de regenerar claves o crear otra aplicación.

Se recuperó una sesión aislada de A y se verificó también el menú de **Datos básicos**: tiene 16 categorías de rubro comercial, ninguna opción Marketplace. Las secciones Producto integrado y Configuración avanzada tampoco ofrecen un selector Marketplace/Authorization Code. El formulario no se modificó y Guardar seguía deshabilitado. La etiqueta del panel continúa siendo integración para la propia cuenta, Checkout Pro / API de Preferencias.

La lectura oficial más reciente, 17:30:09 UTC, conserva los mismos callbacks, PKCE y scopes; aplicación activa, no bloqueada ni deshabilitada, `allow_flow:[]`. A las 17:32:35 UTC, B continúa `disconnected` en QA, sin seller/app ni scopes guardados. Adjuntamos [revision-modelo-y-segundo-error.json](evidencia/revision-modelo-y-segundo-error.json), sin secretos. Sus request IDs corresponden a lecturas de configuración, **no a los fallos de autorización**.

Preguntas adicionales:

5. ¿Qué condición del par **App 4861627125869370 / vendedor B 3796774164** dispara la denegación de compartir información por seguridad? ¿Depende del perfil de prueba, pertenencia de los usuarios a una app, verificación del vendedor, scope o política interna?
6. ¿Hay un permiso específico de Marketplace adicional a `read`, `write`, `offline_access`? Si lo hay, indicar nombre, alcance e impacto antes de solicitar un cambio sensible.
7. Si esta TestApp figura como integración para la propia cuenta, ¿se puede habilitar para terceros conservando Client ID y credenciales? Indicar el procedimiento soportado y dónde está la opción, ya que no aparece en los controles inspeccionados.
8. ¿Valida este flujo únicamente `callback_url` principal o acepta cualquier coincidencia en `callback_urls`? La URL QA enviada está registrada exactamente. No queremos cambiarla por tanteo.

La cuenta personal **721168650** es un contexto distinto, no dueña de TestApp, y no se usó para esta inspección ni para consentir por B. Todavía no tenemos correlación del proveedor que confirme la identidad efectiva del navegador para cada fallo reportado; pedimos qué dato mínimo debe capturarse en un único intento legítimo sin compartir cookies, códigos ni URL de retorno.

Parámetros de autorización comprobados: endpoint oficial `https://auth.mercadopago.com.ar/authorization`, `client_id=4861627125869370`, `response_type=code`, `platform_id=mp`, callback QA exacto, `scope=read write offline_access`, PKCE S256 y state aleatorio de un uso con vigencia diez minutos. Se omiten state, challenge, verifier y enlaces completos de sesión. No se generaron nuevos intentos en esta revisión.

No se han cambiado callbacks, scopes, PKCE, credenciales ni producción. No se envió aún esta consulta. La interpretación de hechos y límites está en [MODELO-Y-DOS-ERRORES.md](MODELO-Y-DOS-ERRORES.md).
