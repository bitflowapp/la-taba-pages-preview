# GPS real del rider sobre Supabase

Esta guía explica cómo funciona el **GPS real del rider end-to-end en modo
Supabase**: el repartidor comparte su ubicación real desde el celular, se
persiste en `rider_locations` y el cliente la ve en el tracking. El **modo demo**
(GitHub Pages sin parámetros) sigue intacto y la **simulación** queda como
fallback.

> Requiere las migraciones de la Fase 1 ya aplicadas (ver
> `docs/supabase-backend-phase-1.md`), incluida la RPC transaccional
> `create_order_with_items`.

## Resumen del flujo

1. El **cliente** crea un pedido de delivery (persistido en Supabase vía RPC).
   Para delivery se cargan calle y número, barrio/zona, referencia para el rider
   y notas del pedido.
2. El **rider** abre la vista Rider, marca el pedido listo / salió del local.
3. El rider toca **Usar mi ubicación real** y acepta el permiso del navegador.
4. La app usa `navigator.geolocation.watchPosition` y publica cada fix real en
   `rider_locations` con `source = "gps"` (con throttling, ver abajo).
5. El **cliente** —en otro dispositivo— recibe la última ubicación por el polling
   de Supabase (cada ~5 s) y el mapa muestra **"Ubicación rider"** moviéndose.
6. Al entregar/cancelar, o al tocar **Detener GPS**, se llama `clearWatch` y se
   deja de publicar.

## Estabilidad visual del tracking

El tracking esta optimizado para sentirse como una app de delivery:

- el mapa Leaflet se crea una sola vez por vista/pedido;
- el tile layer, la ruta y los marcadores fijos no se recrean en cada fix;
- el marcador del rider se conserva y se mueve con `setLatLng(...)`;
- el icono del rider solo cambia cuando cambia estado/fuente/rumbo, evitando
  parpadeos por `removeLayer` / `addLayer`;
- el mapa no vuelve a hacer `fitBounds` por cada ubicacion;
- si el usuario mueve o hace zoom manualmente, la app no recentra agresivamente.

Las vistas de cliente y rider pueden re-renderizar textos o botones, pero el
nodo del mapa real se preserva mientras sea el mismo pedido. Cada nueva
ubicacion actualiza solo marker, linea de progreso y texto de estado.

## Direccion real sin geocoding pago

En esta fase la direccion del cliente es textual y se muestra completa en
checkout, tracking, panel negocio, rider, ticket y WhatsApp:

- **Tracking cliente:** "Entrega en: Calle 123, Barrio" y la referencia si existe.
- **Negocio:** la tarjeta del pedido muestra direccion, referencia, cliente y
  telefono para preparar y despachar.
- **Rider:** la direccion queda destacada, con botones de llamada, WhatsApp y
  copiar direccion.

No se geocodifica ni se inventan coordenadas del cliente. El mapa sigue usando
el local, el rider real y una referencia visual de recorrido para el piloto. Si
no hay coordenadas exactas del destino, la UI lo trata como referencia visual:
el rider opera con la direccion escrita por el cliente.

## Cómo probar GPS real con Supabase

No se hardcodean credenciales: se pasan por la URL (anon key, no secreta) o se
usan sólo localmente.

1. Aplicá las migraciones y verificá el backend con el smoke test
   (ver `docs/supabase-backend-phase-1.md`):

   ```bash
   # PowerShell
   $env:SUPABASE_URL="https://TU-PROYECTO.supabase.co"
   $env:SUPABASE_ANON_KEY="TU_ANON_KEY"
   npm run smoke:supabase
   ```

2. Serví la app por **HTTPS o localhost** (el GPS del navegador lo exige).
   Para dos dispositivos reales, usá un túnel HTTPS (ngrok / cloudflared) que
   exponga el sitio estático.

3. Abrí, en dispositivos distintos:

   ```text
   Cliente: https://TU-HOST/?data=supabase&supabaseUrl=https://TU-PROYECTO.supabase.co&supabaseAnonKey=TU_ANON_KEY
   Rider:   https://TU-HOST/?data=supabase&supabaseUrl=https://TU-PROYECTO.supabase.co&supabaseAnonKey=TU_ANON_KEY#rider
   ```

4. En **Rider**: marcá listo → salí del local → **Usar mi ubicación real** →
   aceptá el permiso → movete.
5. En **Cliente** (pantalla Seguir): el marcador del rider se mueve y el texto
   dice **"Ubicación rider"** con la última actualización.

> El parámetro `businessId` es opcional si usás el negocio seed de la migración.

## Modo demo y fallback

- **Sin parámetros** (GitHub Pages): modo demo puro. Nada se envía a Supabase.
- **`?relay=...&room=...`**: relay LAN para dos celulares (sin backend).
- **`?data=supabase` sin `supabaseUrl`/`supabaseAnonKey`**: cae a demo con un
  aviso técnico discreto (no rompe la UI).
- **Simulación**: si el GPS real falla (permiso denegado, sin contexto seguro,
  sin señal), el rider puede usar el **recorrido de apoyo** y el cliente ve
  *"Ubicación estimada"*. El GPS real, cuando existe, **tiene prioridad** sobre la
  simulación; a igual fuente gana el fix más reciente.

## Throttling y limpieza

Para no saturar la base con escrituras, cada fix se publica sólo si:

- pasaron **≥ 3 segundos** desde el último envío, **o**
- el rider se movió **≥ 15 metros**.

Además:

- al **detener GPS** o salir de la vista Rider se llama `clearWatch` y se resetea
  el throttle (el próximo arranque publica de inmediato);
- no se duplican watchers si se toca el botón dos veces;
- coordenadas inválidas se ignoran;
- si Supabase falla, el fix local se conserva y se muestra el error en el bloque
  *Diagnóstico GPS* (sin romper la UI).

## Filtros de calidad de ubicacion

Antes de aceptar o renderizar un fix se aplican reglas de calidad:

- lat/lng deben ser numericos y estar dentro de rangos validos;
- fixes GPS viejos se marcan como stale y dejan de verse como "en vivo";
- si el GPS sigue fresco, la simulacion no lo pisa;
- si el GPS queda stale, la simulacion puede volver como fallback;
- fixes con precision muy mala se descartan cuando hay uno reciente mejor;
- saltos imposibles por distancia/tiempo se ignoran;
- cambios visuales minimos y muy frecuentes no fuerzan movimiento del marker.

## Limitaciones de web móvil (importante)

- **Contexto seguro:** la geolocalización del navegador requiere **HTTPS o
  localhost**. En LAN por HTTP (`http://192.168.x.x`), especialmente en
  iPhone/Safari, suele fallar. Por eso para prueba real conviene un túnel HTTPS.
- **Background:** una web/PWA **no** garantiza tracking con la pantalla apagada o
  la pestaña en segundo plano. iOS/Android suspenden el `watchPosition` de la web.
  Para tracking serio en background hace falta una **PWA avanzada con permisos
  específicos o una app nativa** con location en segundo plano.
- **Piloto en iPhone:** mantener Safari abierto y la pantalla activa durante la
  prueba fisica. Si iOS pausa la pestaña, el cliente ve la ultima ubicacion con
  antiguedad en vez de un falso estado "en vivo".
- **Precisión y batería:** `enableHighAccuracy: true` consume más batería y la
  precisión depende del dispositivo y el entorno.
- **Polling del cliente:** el cliente lee la última ubicación por polling (~5 s),
  no por websockets todavía. La latencia esperable es de pocos segundos.

## Checklist QA manual

Para validar una prueba fisica de producto:

1. Abrir cliente y rider por HTTPS, misma room/pedido.
2. Crear un pedido de delivery con calle, numero, barrio y referencia real.
3. Confirmar que tracking, negocio y rider muestran la direccion real.
4. En Rider, elegir referencia visual si hace falta, tocar **Compartir mi ubicacion** y aceptar permiso.
5. Caminar o moverse unos metros con Safari visible.
6. Confirmar en cliente: texto **"Ubicacion rider"**, edad de actualizacion,
   marker moviendose sin flashes fuertes, sin reset de zoom/centro.
7. Mover manualmente el mapa y confirmar que no se recentra violentamente.
8. Tocar **Detener GPS** y confirmar que el rider queda en **GPS detenido**.
9. Entregar/cancelar y confirmar que deja de publicarse ubicacion.

## Privacidad

- La ubicación del rider se comparte **sólo mientras el GPS está activo** y para
  el pedido en curso. Al detener GPS o entregar, deja de publicarse.
- En modo demo/relay, la ubicación **no sale a internet** (queda local / LAN).
- En modo Supabase, la ubicación se guarda en `rider_locations` del proyecto
  configurado. **No usar datos sensibles** en el piloto: la Fase 1 todavía no
  tiene auth ni RLS por rol (ver límites en `docs/supabase-backend-phase-1.md`).
- No se imprimen ni se commitean claves; la anon key se pasa por parámetro/entorno.

## Qué falta para producción (Fase 2+)

- Auth real y RLS por `business_id` / rol (negocio, rider, cliente).
- Supabase Realtime (websockets) en vez de polling.
- Tracking en background confiable (PWA avanzada o app nativa).
- Retención/anonimización de ubicaciones y consentimiento explícito del rider.
