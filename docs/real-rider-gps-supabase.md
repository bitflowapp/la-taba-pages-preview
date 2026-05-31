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
2. El **rider** abre la vista Rider, marca el pedido listo / salió del local.
3. El rider toca **Activar GPS real** y acepta el permiso del navegador.
4. La app usa `navigator.geolocation.watchPosition`, muestra el marcador
   **"Tu ubicación real"** en el mapa Rider al primer fix y publica cada lectura
   real en `rider_locations` con `source = "gps"` (con throttling, ver abajo).
5. El **cliente** —en otro dispositivo— recibe la última ubicación por el polling
   de Supabase (cada ~5 s) y el mapa muestra **"Ubicación rider"** moviéndose.
6. Al entregar/cancelar, o al tocar **Detener GPS**, se llama `clearWatch` y se
   deja de publicar.

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

4. En **Rider**: marcá listo → salí del local → **Activar GPS real** →
   aceptá el permiso → movete.
5. En **Rider**: el mapa centra el primer fix, muestra **"Tu ubicación real"**,
   precisión y última actualización. Antes del primer fix debe decir
   **"Buscando señal GPS..."**, no **"GPS real activo"**.
6. En **Cliente** (pantalla Seguir): el marcador del rider se mueve y el texto
   dice **"Ubicación rider"** con la última actualización.

> El parámetro `businessId` es opcional si usás el negocio seed de la migración.

## Modo demo y fallback

- **Sin parámetros** (GitHub Pages): modo demo puro. Nada se envía a Supabase.
- **GitHub Pages sin `data=supabase`**: abre demo por defecto. El GPS real puede
  usarse para la presentación del rider si el navegador está en HTTPS y el usuario
  acepta el permiso, pero no se persiste en Supabase.
- **`?relay=...&room=...`**: relay LAN para dos celulares (sin backend).
- **`?data=supabase` sin `supabaseUrl`/`supabaseAnonKey`**: cae a demo con un
  aviso técnico discreto (no rompe la UI).
- **GPS real**: requiere HTTPS/localhost, permiso del navegador y el botón
  **Activar GPS real** en Rider. La UI sólo muestra **"GPS real activo"** cuando
  llegó un fix válido.
- **Recorrido guiado**: si el GPS real falla (permiso denegado, sin contexto
  seguro, sin señal), el rider puede usar **Iniciar ruta estimada**. El cliente ve
  *"Ubicación estimada"* y la vista Rider lo etiqueta como recorrido de prueba.
  El GPS real, cuando existe, **tiene prioridad** sobre la simulación; a igual
  fuente gana el fix más reciente.

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

## Limitaciones de web móvil (importante)

- **Contexto seguro:** la geolocalización del navegador requiere **HTTPS o
  localhost**. En LAN por HTTP (`http://192.168.x.x`), especialmente en
  iPhone/Safari, suele fallar. Por eso para prueba real conviene un túnel HTTPS.
- **Background:** una web/PWA **no** garantiza tracking con la pantalla apagada o
  la pestaña en segundo plano. iOS/Android suspenden el `watchPosition` de la web.
  Para tracking serio en background hace falta una **PWA avanzada con permisos
  específicos o una app nativa** con location en segundo plano.
- **Precisión y batería:** `enableHighAccuracy: true` consume más batería y la
  precisión depende del dispositivo y el entorno.
- **Polling del cliente:** el cliente lee la última ubicación por polling (~5 s),
  no por websockets todavía. La latencia esperable es de pocos segundos.

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
