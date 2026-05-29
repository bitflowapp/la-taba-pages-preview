# La Taba · GitHub Pages Preview v4.1

Preview web/PWA de un sistema de pedidos propio para una carnicería o local de comida con delivery.

Esta versión está pensada para mostrar un MVP comercial sin backend todavía. Corre en GitHub Pages, Vercel, Netlify o un servidor local simple.

> **v4.1 (revisión final):** IDs de pedido sin colisión, carrito y pedidos saneados contra datos corruptos en localStorage, storage key actualizado a v4 para evitar cruces con versiones viejas, manejo tolerante a fallos de storage, service worker *network-first* con fallback más seguro, fecha/hora en el mensaje de WhatsApp, ventas y pedidos del día reales, métrica de pedidos activos corregida, panel delivery filtrado para pedidos con envío, y mejoras de accesibilidad y seguimiento.

## Qué incluye

- Catálogo responsive con categorías.
- Buscador de productos.
- Carrito con cantidades, stock y totales.
- Checkout con envío a domicilio o retiro en local.
- Pedido mínimo para delivery.
- Mensaje de WhatsApp profesional con resumen completo.
- Botón para copiar pedido.
- Seguimiento mock del último pedido.
- Modo negocio protegido con PIN demo `1234`.
- Panel negocio con pedidos, estados, métricas y stock rápido.
- Panel delivery con pedido asignado y acciones.
- PWA instalable con manifest y service worker.
- Código modular en `/js` para que Codex/Claude pueda seguir escalándolo sin romper todo.

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

1. Crear un repositorio nuevo en GitHub.
2. Subir todos los archivos de este ZIP a la raíz del repo.
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

## Modo negocio

El cliente normal ve catálogo, carrito, seguimiento y perfil.

Para ver panel negocio y delivery:

1. Tocar `Modo negocio`.
2. Ingresar PIN `1234`.
3. Se habilitan las secciones de negocio y delivery.

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

## Próxima fase recomendada

Antes de conectar backend, conviene pasar esto a Codex/Claude para:

1. Revisar accesibilidad y estados vacíos.
2. Mejorar el diseño visual con fotos reales del comercio.
3. Dejar lista una capa `repositories/` para reemplazar `localStorage` por Supabase.
4. Preparar autenticación de negocio y repartidor.
5. Agregar panel real de pedidos con base de datos.

## Qué no tiene todavía

- Supabase/Firebase real.
- Mercado Pago real.
- Google Maps real.
- Notificaciones push reales.
- Login real.

Eso está bien: esta v4.1 está pensada para vender y validar primero, no para pagar infraestructura antes de saber si el negocio avanza.
