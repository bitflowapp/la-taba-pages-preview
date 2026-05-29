# La Taba · Sistema de pedidos online (demo)

**La Taba** es el sistema propio de pedidos online de una carnicería/local de comida con delivery.

El cliente entra a un link, arma el pedido desde el celular y el negocio lo recibe **ordenado por WhatsApp**: con nombre, dirección, productos, total, forma de pago y notas. Es una base para que La Taba tenga un canal propio de pedidos, sin depender por completo de plataformas externas.

> 🔗 **Demo publicada:** https://bitflowapp.github.io/la-taba-pages-preview/

Es una web/PWA estática, sin backend todavía. Corre en GitHub Pages, Vercel, Netlify o un servidor local.

## En 30 segundos: ¿qué resuelve?

| Antes (WhatsApp suelto) | Con La Taba |
| --- | --- |
| Audios y mensajes desordenados | Pedido escrito y completo, siempre igual |
| Errores al anotar a mano | Productos, cantidades y total automáticos |
| Todo queda mezclado en el chat | Pedido ordenado con formato consistente |
| Dependés de una plataforma | Tu marca, tu link, tu reparto |

- **¿Qué es?** Tu propio sistema de pedidos online.
- **¿Cómo recibe pedidos el negocio?** Por WhatsApp, ya ordenados.
- **¿Qué ve el cliente?** Catálogo, carrito y finalizar pedido.
- **¿Qué controla el dueño?** Pedidos, estados, ventas del día, stock y reparto.
- **¿Cómo se prueba?** Botón "Comprar como cliente" o PIN `1234` para administrar pedidos.

## Diferencia honesta frente a una app de delivery

Esta demo no promete reemplazar de golpe a PedidoYa ni traer una red propia de clientes. Sirve para otra cosa: darle a La Taba un link propio para clientes frecuentes, Instagram, WhatsApp y QR del local. El pedido llega claro, con total calculado y listo para responder.

## Cómo probar la demo

### Como cliente
1. Abrí la demo o `index.html`.
2. En **Inicio** elegí una categoría o tocá **Ver catálogo**.
3. En **Catálogo** filtrá por categoría, agregá productos, abrí **Pedido** y elegí **Envío a domicilio** o **Retiro en local**.
4. Completá nombre, teléfono y dirección y tocá **Enviar pedido por WhatsApp**.
5. Se abre WhatsApp con el pedido escrito, listo para enviar.

### Como negocio (administrar pedidos)
1. Tocá **Administrar pedidos** arriba a la derecha o **Panel negocio** desde **Local**.
2. Ingresá el **PIN demo `1234`**.
3. Vas a ver: pedidos entrantes, ventas del día, pedidos activos y stock bajo.
4. Acciones por pedido: **Aceptar pedido → Marcar listo para enviar → Enviar con repartidor → Marcar entregado**, o **Cancelar**.

### Como repartidor (con simulación en tiempo real demo)
1. Con el modo negocio activo, marcá un pedido de delivery como **listo** en el panel.
2. Tocá **Vista rider** desde el panel o **Repartidor** desde **Local**.
3. Vas a ver el pedido asignado con **Salí del local**, **Llegué al domicilio** y **Pedido entregado**.
4. En **Simulación de reparto en tiempo real (demo)** podés:
   - **Iniciar simulación**: el rider sale del local y se mueve solo por el mapa demo, con el progreso y el ETA actualizándose.
   - **Pausar** y **Reiniciar** la simulación.
   - **Usar mi ubicación para demo** (GPS opcional): pide permiso solo al tocarlo; si falla, lo avisa y sigue funcionando con la simulación local.
5. Mientras la simulación avanza, la pantalla de **Seguir** del cliente se actualiza sola (rider en camino → llegando → entregado), sin recargar.

> **PIN demo: 1234** — acceso de demostración para la presentación.

### ⚠️ Importante: la simulación es local

El movimiento del rider, el progreso y el ETA se calculan **en este dispositivo**
(simulación local con `setInterval`, persistida en `localStorage` para que un
reload no rompa el estado). El GPS opcional usa `navigator.geolocation` y la
ubicación **no se envía a ningún servidor** porque todavía no hay backend.

Para **tiempo real real entre el celular del cliente y el del repartidor** (en
equipos distintos) hace falta un backend realtime: **Supabase Realtime, Firebase
Realtime Database/Firestore o un WebSocket** propio. Esa es la siguiente fase y
está documentada abajo; no se implementa en esta rama a propósito.

## Cambiar el WhatsApp del negocio

Editar `js/config.js` y cambiar `whatsappNumber` (formato internacional, sin `+` ni espacios):

```js
whatsappNumber: '5492996209136', // 549 + característica + número
```

## Catálogo por categorías

El catálogo está organizado como una app de delivery real: el cliente entra al
**Inicio** (estado del local, buscador, categorías, promos y combos) y, al elegir
una categoría o tocar **Ver catálogo**, pasa a la pantalla **Catálogo**, donde ve
los productos filtrados, las ofertas de esa categoría, puede ordenar
(recomendados / menor precio / más pedidos) y buscar.

Categorías incluidas (editables en `js/data.js`): Promos, Combos, Carnes, Pollos,
Achuras, Embutidos, Gaseosas, Bebidas, Lácteos (demo), Almacén y Retiro en local.

> **Nota sobre categorías demo y alcohol.** "Bebidas" y "Gaseosas" son categorías
> seguras. Las categorías marcadas con `demo: true` (por ejemplo **Lácteos**) son
> configurables: el comercio puede ocultarlas o editarlas desde `js/data.js` y
> `BUSINESS_CONFIG.demoCategories`. **No se incluyen bebidas alcohólicas.** Una
> eventual categoría "Alcohol" debería quedar como demo configurable y editable
> por el comercio, nunca con ventas falsas ni promesas que no se puedan cumplir.

## Editar productos

Editar `js/data.js`. Cada producto tiene id, nombre, descripción, categoría,
precio (con `oldPrice` opcional para ofertas), stock, unidad y metadatos sobrios
para el thumbnail (`tone`). No se usan fotos falsas ni emojis gigantes como
imagen: el placeholder muestra las iniciales del producto sobre un bloque tonal.

```js
{
  id: 'p-asado-especial',
  name: 'Asado especial',
  description: 'Tira de asado seleccionada para parrilla lenta.',
  categoryId: 'carnes',
  tone: 'beef',          // bloque tonal del thumbnail (ver styles.css)
  price: 9800,
  oldPrice: 11200,       // opcional: muestra % OFF
  stock: 12,
  available: true,
  featured: true,
  popular: true,         // opcional: aparece como "Más pedido"
  badge: 'Más pedido',   // opcional
  unit: 'kg',
  unitLabel: '1 kg aprox.',
  marketNote: 'Precio estimado de mercado, editable desde el panel.',
  prepMinutes: 20,
},
```

## Qué incluye

- Home tipo app de delivery: estado del local, buscador, categorías, promos y combos (sin lista infinita).
- Pantalla de catálogo por categorías reales, con ofertas de categoría, orden (recomendados / menor precio / más pedidos) y búsqueda.
- Carrito con cantidades, control de stock y totales.
- Finalizar pedido con envío a domicilio o retiro en local.
- Pedido mínimo para delivery.
- Mensaje de WhatsApp completo y profesional (cliente, productos, totales, pago, notas y fecha).
- Botón para copiar el pedido.
- Seguimiento del último pedido (vista de demo).
- Modo negocio protegido con PIN demo `1234`.
- Administración de pedidos: estados, ventas del día, pedidos activos y stock rápido.
- Vista de repartidor con pedido asignado, acciones de salida/entrega y **simulación de reparto en tiempo real (demo local)** con progreso, ETA y GPS opcional.
- PWA instalable con manifest y service worker (se usa como una app).
- Código modular en `/js`, fácil de escalar sin romper lo existente.

## Probar localmente

Desde PowerShell:

```powershell
cd ruta\donde\descomprimiste\la-taba
.\run-local.ps1
```

Abrir:

```text
http://localhost:8080
```

También podés usar:

```powershell
python -m http.server 8080
```

## Subir a GitHub Pages

1. Subir el proyecto a un repositorio de GitHub (`git push`).
2. Asegurarse de que los archivos estén en la raíz del repo.
3. Ir a `Settings > Pages`.
4. En `Build and deployment`, elegir:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
5. Guardar.
6. Esperar a que GitHub genere la URL pública.

## Cambiar datos del negocio

Editar:

```text
js/config.js
```

Ahí se cambia:

- nombre del negocio
- WhatsApp
- dirección
- costo de envío
- pedido mínimo
- horarios
- zona de entrega
- PIN del modo negocio

Ejemplo:

```js
export const BUSINESS_CONFIG = Object.freeze({
  businessName: 'La Taba',
  whatsappNumber: '5492996209136',
  deliveryFee: 1200,
  minDeliveryOrder: 5000,
  adminPin: '1234',
});
```

## Acceso del negocio

El cliente ve catálogo, mi pedido, seguimiento y datos del comercio.

Para ver la administración de pedidos y el reparto:

1. Tocar **Administrar pedidos**.
2. Ingresar PIN `1234`.
3. Se habilitan las secciones de negocio y repartidor.

## Cómo correr los tests

```powershell
npm run check     # sintaxis JS + assets estáticos
npm test          # tests unitarios (node:test)
npm run test:e2e  # smoke tests de Playwright
npm run verify    # corre las tres anteriores
```

## Estructura técnica

```text
index.html
styles.css
sw.js
manifest.webmanifest
assets/
  icon.svg
js/
  config.js
  data.js
  state.js
  cart.js
  orders.js
  business.js
  delivery.js
  simulation.js        # controlador de la simulación de reparto (timers + GPS)
  ui.js
  app.js
  core/
    simulation.js      # motor puro de la simulación (testeable, sin timers ni DOM)
    rider.js
    order-status.js
    pricing.js
    business-metrics.js
    storage.js
    validators.js
```

## Cómo se vería como sistema real (próxima fase)

La base ya está pensada para crecer sin reescribir todo:

1. Fotos reales de los productos del local.
2. Capa `repositories/` para reemplazar `localStorage` por una base de datos (ej. Supabase).
3. **Reparto en tiempo real real** entre cliente y rider en celulares distintos, con un backend realtime (Supabase Realtime, Firebase o WebSocket). La simulación actual y el GPS opcional ya dejan preparada la forma del dato (`demoRouteProgress`, `simulatedEtaMinutes`, lat/lng).
4. Login real de negocio y repartidor.
5. Pagos online reales (Mercado Pago).
6. Mapa con tiles reales (Google Maps / Leaflet) para seguir al repartidor.
7. Notificaciones de pedidos nuevos.

## Qué no tiene todavía (a propósito)

- Base de datos / backend real.
- Mercado Pago real.
- Google Maps real.
- Notificaciones push reales.
- Login real.

Esto es a propósito: la demo está pensada para **vender y validar primero**, sin pagar infraestructura antes de saber si el negocio avanza.
