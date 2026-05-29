# La Taba · Sistema de pedidos online (demo)

**La Taba** es el sistema propio de pedidos online de una carnicería/local de comida con delivery.

El cliente arma el pedido desde el celular y el negocio lo recibe **ordenado por WhatsApp**: con nombre, dirección, productos, total, forma de pago y notas. Sin audios, sin anotar a mano y **sin pagar comisiones** de las apps de delivery.

> 🔗 **Demo publicada:** https://bitflowapp.github.io/la-taba-pages-preview/

Es una web/PWA estática, sin backend todavía. Corre en GitHub Pages, Vercel, Netlify o un servidor local.

## En 30 segundos: ¿qué resuelve?

| Antes (WhatsApp suelto) | Con La Taba |
| --- | --- |
| Audios y mensajes desordenados | Pedido escrito y completo, siempre igual |
| Errores al anotar a mano | Productos, cantidades y total automáticos |
| Comisiones de apps de delivery | Sin comisiones: es tu propio canal |
| Dependés de una plataforma | Tu marca, tu link, tu reparto |

- **¿Qué es?** Tu propio sistema de pedidos online.
- **¿Cómo recibe pedidos el negocio?** Por WhatsApp, ya ordenados.
- **¿Qué ve el cliente?** Catálogo, carrito y finalizar pedido.
- **¿Qué controla el dueño?** Pedidos, estados, ventas del día, stock y reparto.
- **¿Cómo se prueba?** Botón "Probá la demo" o PIN `1234` para el modo negocio.

## Cómo probar la demo

### Como cliente
1. Abrí la demo o `index.html`.
2. Tocá **Probar como cliente** (o entrá al catálogo).
3. Agregá productos, abrí **Mi pedido**, elegí **Envío a domicilio** o **Retiro en local**.
4. Completá nombre, teléfono y dirección y tocá **Confirmar y abrir WhatsApp**.
5. Se abre WhatsApp con el pedido escrito, listo para enviar.

### Como negocio (administrar pedidos)
1. Tocá **Administrar pedidos** (arriba a la derecha o en la sección *Probá la demo*).
2. Ingresá el **PIN demo `1234`**.
3. Vas a ver: pedidos entrantes, ventas del día, pedidos activos y stock bajo.
4. Acciones por pedido: **Aceptar pedido → Listo para enviar → Enviar con repartidor → Marcar entregado**, o **Cancelar**.

### Como repartidor
1. Con el modo negocio activo, tocá **Ver repartidor** (sección *Probá la demo*) o el menú #delivery.
2. Vas a ver el pedido asignado, con **Salí del local** y **Pedido entregado**.

> **PIN demo: 1234** — acceso de demostración para la presentación.

## Cambiar el WhatsApp del negocio

Editar `js/config.js` y cambiar `whatsappNumber` (formato internacional, sin `+` ni espacios):

```js
whatsappNumber: '5492996209136', // 549 + característica + número
```

## Editar productos

Editar `js/data.js`. Cada producto tiene nombre, descripción, categoría, ícono, precio, stock, unidad y si está destacado:

```js
{
  id: 'p-asado-especial',
  name: 'Asado especial',
  description: 'Corte seleccionado para parrilla.',
  categoryId: 'carnes',
  icon: '🥩',
  price: 9800,
  stock: 12,
  available: true,
  featured: true,
  unit: 'kg',
  prepMinutes: 20,
},
```

## Qué incluye

- Catálogo responsive con categorías y buscador.
- Carrito con cantidades, control de stock y totales.
- Finalizar pedido con envío a domicilio o retiro en local.
- Pedido mínimo para delivery.
- Mensaje de WhatsApp completo y profesional (cliente, productos, totales, pago, notas y fecha).
- Botón para copiar el pedido.
- Seguimiento del último pedido (vista de demo).
- Modo negocio protegido con PIN demo `1234`.
- Administración de pedidos: estados, ventas del día, pedidos activos y stock rápido.
- Vista de repartidor con pedido asignado y acciones de salida/entrega.
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
  ui.js
  app.js
```

## Cómo se vería como sistema real (próxima fase)

La base ya está pensada para crecer sin reescribir todo:

1. Fotos reales de los productos del local.
2. Capa `repositories/` para reemplazar `localStorage` por una base de datos (ej. Supabase).
3. Login real de negocio y repartidor.
4. Pagos online reales (Mercado Pago).
5. Mapa con GPS real para seguir al repartidor.
6. Notificaciones de pedidos nuevos.

## Qué no tiene todavía (a propósito)

- Base de datos / backend real.
- Mercado Pago real.
- Google Maps real.
- Notificaciones push reales.
- Login real.

Esto es a propósito: la demo está pensada para **vender y validar primero**, sin pagar infraestructura antes de saber si el negocio avanza.
