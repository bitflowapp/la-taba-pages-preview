# La Taba · operación del piloto

**Estado: NO ABRIR TODAVÍA.** Falta aprobar catálogo comercial, verificar backup
externo de la firma Rider y desplegar un backend/dominio PILOTO aislado. Las URL
de Staging son sólo QA; la APK `com.lataba.rider.pilot` v3 todavía apunta a
Staging. No darla a repartidores comerciales.

## Ficha de lanzamiento

| Dato | Valor actual |
|---|---|
| URL cliente PILOTO | Pendiente de deploy |
| URL panel PILOTO | Pendiente de deploy |
| Proyecto Supabase PILOTO | Pendiente de crear; nunca Producción ni Staging QA |
| APK Rider PILOTO | Pendiente de build firmado vCode ≥ 4 para ese proyecto |
| Deployment anterior recuperable | Pendiente de primera publicación PILOTO |
| Medio de pago | Manual solamente; Mercado Pago deshabilitado |

Completar esta ficha con URL, SHA, runtime, deployment ID, versión APK y
fingerprint público antes de invitar a alguien. Alcance: un comercio, hasta tres
riders y unos 10–20 clientes conocidos. No anunciar ni abrir autorregistro
masivo. Las cuentas QA y productos demo nunca son el catálogo comercial.
La hoja `catalogo-para-aprobar.xlsx` reúne 33 productos históricos con foto
verificada; **cero** tienen precio vigente, stock, descripción y publicación
aprobados para PILOTO. No importar esa hoja directamente.

## Compuertas antes del deploy

1. Restaurar la firma desde un backup **externo** a la PC, firmar una APK de
   prueba y comprobar que coincide el certificado. La copia local de
   Credential Manager ya pasó esa prueba, pero no sustituye el backup externo.
2. El comercio aprueba por escrito el catálogo, precios vigentes, stock,
   descripción, fotos y qué productos se publican. Validar y ensayar el
   importador; no copiar fixtures QA ni precios históricos sin aprobación.
3. Crear proyecto Supabase y proyecto Cloudflare Pages **PILOTO** nuevos,
   separados de DEMO, Staging QA y Producción. Instalar migraciones y comprobar
   roles/RLS. No configurar seller ni secretos de Mercado Pago.
4. Configurar runtime web con `deploymentEnvironment=pilot`, ref Supabase y
   businessId de ese proyecto. El gate rechaza los refs de DEMO, Staging y
   Producción y bloquea enlaces `?demo=1` y Rider web. Compilar Android
   `--target pilot` con el mismo ref y su propia clave publicable; versionCode
   ≥ 4. Revisar la ficha antes de instalar.
5. Publicar de forma explícita desde la rama release, smoke público, pedido QA
   terminal y limpieza. Conservar dos deployments compatibles del proyecto
   PILOTO y ensayar rollback allí. Sólo entonces rellenar las URL de la ficha y
   abrir el grupo pequeño.

## Alta controlada

1. **Comercio y dueño:** el operador técnico crea el negocio en PILOTO y
   habilita al primer owner sólo tras verificar su identidad. El primer usuario
   no se vuelve dueño por registrarse. Si el correo de alta no está certificado,
   el operador usa la provisión controlada y entrega un enlace individual para
   que la persona establezca su acceso; no comparte contraseñas.
2. **Rider:** crear su cuenta individual en PILOTO, pedir acceso al negocio y,
   en Panel → **Solicitudes**, el owner selecciona **Repartidor** y aprueba.
   Instalar sólo la APK PILOTO cuyo proyecto y certificado figuren en la ficha.
   Iniciar sesión en Android y comprobar **Disponible** tanto en Moto como en
   Panel → **Pedidos**. No conceder más de tres riders para este piloto.
3. **Cliente:** crear/invitar una cuenta individual controlada. Pedirle que
   confirme dirección y zona desde la web; verificar que pueda ver catálogo y
   carrito antes de recibir pedidos. Deshabilitar o restablecer accesos mediante
   el flujo administrativo de Auth, revocando sesiones cuando corresponda. No
   reutilizar credenciales QA ni enviar contraseñas por chat.

## Turno del negocio

1. Panel → **Abrir** → **Volver a revisar**. Resolver bloqueos de cobertura,
   stock, riders o caja y recién entonces **Abrir el negocio**. Para dejar de
   aceptar pedidos, Panel → **Abrir** → **Pausar pedidos**; no equivale a cerrar
   caja. **Cerrar** registra el cierre diario por separado.
2. Panel → **Nuevo producto** crea un borrador. Completar identidad, variante,
   precio, foto aprobada y disponibilidad; owner/admin revisa y publica. Usar
   **Recepción**, **Ajuste** o **Conteo físico** para cambiar stock con motivo y
   evidencia. Nunca editar stock por SQL. No publicar un producto cuyo precio,
   foto, derecho de uso o stock no aprobó el comercio. Antes de una carga masiva,
   guardar el catálogo anterior y ensayar el importador; todas las altas quedan
   despublicadas hasta revisión. Si un lote sale mal, despublicar los productos
   afectados y aplicar correcciones auditadas; no borrar snapshots de pedidos.
3. Panel → **Pedidos**: recibir → aceptar → preparar → listo. En la tarjeta del
   pedido, elegir un rider disponible y pulsar **Ofrecer**. El rider acepta en
   Android. Verificar asignación y estado **en reparto** en el panel. El cliente
   sigue el pedido en la web y da el código de cuatro dígitos al rider al
   recibirlo; sólo Android confirma la entrega.
4. En checkout, el cliente elige el pago manual acordado con el comercio. En
   Panel → **Pagos**, **Cobro pendiente** no significa pagado. Un rol autorizado
   pulsa **Registrar efectivo recibido** o **Registrar transferencia recibida**
   sólo después de verificar dinero recibido. Una devolución se registra con
   **Registrar devolución realizada** sólo después de devolverlo. No usar
   **Conectar Mercado Pago**, no crear cobros ni refunds MP en el piloto.

## Incidentes

- **Pedido trabado:** actualizar **Pedidos** y leer estado/revisión antes de
  repetir una acción. Si sigue en el local, cancelar desde la tarjeta con
  motivo y verificar retorno de stock una sola vez. Si ya salió, coordinar con
  el rider y soporte; no poner `delivered` ni reponer mercadería por SQL.
- **GPS viejo:** comprobar conectividad, ubicación precisa, notificación del
  servicio foreground y sesión del Rider. Avisar al cliente que el mapa no está
  actualizado. No simular GPS ni prometer ETA fresca. El mapa base externo
  puede fallar y mostrar un fallback; el estado del pedido sigue visible.
- **Acceso perdido:** el owner/operador revoca o deshabilita la cuenta y sus
  sesiones, luego inicia recuperación individual. No prestar cuentas.
- **Pausar todo el piloto:** Panel → **Abrir** → **Pausar pedidos**, riders en
  **No disponible**, detener nuevas invitaciones y comunicar pedidos activos.
  Conservar evidencia de pedidos y cobros; no borrar filas para “vaciar”.

## Recuperación

Antes de cambiar versión, guardar el SHA, runtime, deployment ID y estado del
pedido afectado. En Cloudflare Pages del proyecto **PILOTO**, seleccionar un
deployment anterior exitoso y compatible, restaurarlo y verificar `version.json`,
catálogo, login, panel y un pedido de control. Un rollback web no revierte datos
ni migraciones: la base requiere un forward-fix o migración compensatoria
probada. Conservar el APK Rider anterior firmado con la misma clave; Android
puede exigir desinstalar sólo `com.lataba.rider.pilot` para bajar versión, lo
que borra su sesión local pero no pedidos del servidor. Nunca desinstalar la
APK histórica `com.lataba.rider` v146.

El backup externo de la firma debe poder descargarse, restaurarse y firmar un
APK de prueba con el mismo certificado antes del primer despliegue comercial.
El drill ya ejecutado en **Staging** no sustituye el rollback del proyecto
PILOTO. No tocar Producción ni conectar una cuenta de Mercado Pago real.
