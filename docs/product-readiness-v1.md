# Product Readiness v1

## 1. Estado actual del producto

La Taba ya funciona como una demo comercial avanzada con flujo completo cliente-negocio-rider: catálogo editable, checkout, pedidos, consola operativa, reparto visual, tracking honesto, foto de entrega, código de entrega delivery local-first, caja/reportes y configuración del comercio. La app está preparada para GitHub Pages y conserva el modo demo como default.

El estado actual no debe presentarse como plataforma productiva completa. Todavía depende de almacenamiento local, no tiene autenticación real, no tiene backend obligatorio, no tiene cola offline, no tiene storage de fotos y no tiene notificaciones push.

## 2. Partes ya usables como producto

- Catálogo editable: permite cargar, editar, pausar, archivar y restaurar productos demo.
- Pedidos: el checkout crea pedidos con snapshots de ítems, totales y datos de cliente.
- Reparto: el panel rider puede ver pedidos, avanzar estados y usar GPS real si el navegador lo permite.
- Código de entrega delivery local-first: el cliente ve un código de 4 dígitos en Seguimiento, el rider puede confirmarlo y el negocio ve si quedó validado.
- Tracking honesto: sin GPS real no muestra mapa, marcador, ruta, km, ETA ni rider inventado.
- Caja/reportes: muestra ventas, tickets, cancelaciones, métodos de pago y ranking basado en snapshots.
- Configuración del comercio: permite editar identidad, WhatsApp, dirección, horarios, zona, delivery, pedido mínimo, prefijo y PIN.

## 3. Partes que siguen siendo demo

- Persistencia principal en `localStorage`: no hay garantía productiva contra limpieza de navegador, corrupción local o cambio de dispositivo.
- PIN en texto plano: sirve como guardrail demo, no como autenticación segura.
- Sin auth real: no hay roles, sesiones, usuarios, revocación ni auditoría por persona.
- Backend opcional: Supabase y HTTP son opt-in; GitHub Pages sigue demo por defecto.
- Sin storage real de fotos: no hay prueba visual de entrega persistida en backend.
- Código de entrega delivery local/demo: ayuda a confirmar recepción, pero no es auditoría legal ni persiste fuera del storage actual.
- Sin push notifications: el comercio y el rider dependen de la pantalla abierta o del relay/demo.
- Sin offline queue: eventos de reparto y negocio pueden perderse si el navegador queda offline.
- Sin multi-comercio real: existe configuración del comercio, pero no tenant seguro, slug, dominios ni separación de datos.
- URL demo en GitHub Pages: apta para venta/demostración, no para contrato productivo.
- Datos seed/demo: productos, rutas y destinos siguen siendo base de demostración.

## 4. Riesgos operativos reales

- Pérdida de pedidos: si se limpia el storage, cambia el navegador o falla la hidratación local.
- Pérdida de eventos: cambios de estado o ubicación pueden no persistir fuera del cliente.
- Mala señal: el rider puede perder GPS o conexión; el cliente debe ver fallback honesto.
- Reclamos de entrega: foto y código ayudan en demo, pero sin backend, incidente firmado o auditoría server-side todavía hay evidencia limitada ante "no llegó".
- Datos corruptos: storage viejo o edits parciales pueden dejar reportes o catálogo inconsistentes.
- Comercio mal configurado: WhatsApp, horarios, prefijo o delivery pueden quedar incorrectos.
- Pantalla bloqueada: sin notificaciones, el negocio puede no enterarse de pedidos nuevos.
- Rider sin GPS: tracking no puede prometer ubicación en vivo si el navegador no comparte GPS.
- Cliente dice "no llegó": hoy hay confirmación local por código, pero falta persistencia productiva, incidencia estructurada y auditoría de backend.

## 5. Ranking de próximos PRs recomendados

Completados local-first:

- Delivery Proof Photo v1: foto comprimida local, visible para negocio, sin storage backend todavía.
- Delivery PIN v1: código de entrega simple para confirmar recepción en el flujo rider de delivery.

Siguientes PRs recomendados:

1. Delivery Incidents v1: motivos y notas estructuradas para problemas de reparto.
2. Notifications v1: avisos visibles/sonoros en negocio y rider, sin push externo inicialmente.
3. Offline Event Queue v1: cola local de eventos con reintentos y estados de sincronización.
4. Backend Readiness v1: contrato final para Supabase/API, seeds, migraciones y smoke real.
5. Multi-business Slug/QR v1: URL por comercio, QR y separación mínima de configuración.

## 6. Qué NO prometer todavía

- No prometer persistencia productiva garantizada.
- No prometer seguridad de acceso ni control de empleados.
- No prometer ubicación del rider si no hay GPS real activo.
- No prometer ETA, km o ruta real sin datos reales.
- No prometer notificaciones push.
- No prometer auditoría legal de entregas.
- No prometer operación multi-sucursal o multi-comercio segura.
- No prometer backup, recuperación ni soporte ante borrado del navegador.

## 7. Qué SÍ se puede prometer ahora

- Demo comercial navegable en mobile.
- Flujo completo de pedido desde cliente hasta entrega.
- Panel operativo para visualizar y avanzar pedidos.
- Catálogo editable para simular operación real.
- Caja/reportes básicos basados en pedidos entregados.
- Configuración editable de identidad y operación del comercio.
- Código de entrega delivery local-first para validar recepción en demo.
- Tracking honesto: no inventa ubicación, ruta, km ni ETA.
- Camino preparado para backend opt-in sin romper demo.

## 8. Checklist de demo comercial

- Home carga en GitHub Pages.
- Catálogo carga y permite búsqueda/filtros.
- Carrito y checkout funcionan.
- WhatsApp secundario no se abre automáticamente.
- Tracking abre y explica si no hay GPS real.
- Panel negocio ve pedidos.
- Rider ve pedidos y puede avanzar estados.
- Cliente ve código de entrega en delivery y rider puede confirmarlo.
- Simulación fallback sigue funcionando como demo explícita.
- Caja/reportes muestran ventas entregadas y cancelaciones.
- Configuración guarda identidad/WhatsApp/horarios/delivery/PIN.
- Mobile 390x844 no tiene overflow horizontal ni CTAs tapados por bottom nav.

## 9. Checklist de producción mínima

- Backend persistente obligatorio para pedidos/eventos.
- Auth real con roles negocio/rider/admin.
- RLS/policies endurecidas para datos por comercio.
- Storage seguro para foto de entrega.
- PIN o confirmación de entrega.
- Incidencias de reparto con motivo, nota y timestamp.
- Cola offline con reintentos y reconciliación.
- Notificaciones para pedido nuevo y cambio de estado.
- Tenant/slug por comercio.
- Backups y migraciones probadas.
- Observabilidad mínima: errores, eventos críticos y health checks.
- Política clara de privacidad para cliente/rider.

## 10. Criterios de ready for first real pilot

- Un comercio piloto puede operar sin depender de datos demo.
- Los pedidos se persisten fuera del navegador del cliente.
- El negocio y el rider tienen acceso separado y seguro.
- La entrega tiene al menos una prueba verificable: foto, PIN o incidencia.
- La app no promete GPS si el navegador no entrega GPS real.
- Las pérdidas de conexión quedan registradas o en cola local.
- Hay rollback operativo: exportar pedidos/reportes y recuperar configuración.
- QA manual cubre cliente, negocio, rider, reload, sin GPS, sin relay, room distinta y mobile 390x844.
- El equipo tiene un runbook para migraciones, soporte y limpieza de datos piloto.
