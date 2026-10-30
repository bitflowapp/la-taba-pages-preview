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
