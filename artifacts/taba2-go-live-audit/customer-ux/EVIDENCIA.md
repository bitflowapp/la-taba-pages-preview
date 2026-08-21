# Auditoría READ-ONLY — Experiencia Customer en producción

- **Host**: https://la-taba.pages.dev · **Fecha**: 2026-08-21 (19:37 UTC)
- **Condiciones**: cliente anónimo, Chromium (Playwright), viewport **390x844**, `reducedMotion: reduce`, sin sesión previa.
- **Límite respetado**: navegación, lectura y carrito en memoria. **No** se confirmó pedido, **no** se creó perfil, **no** se tocó `Confirmar pedido`. El registro completo de requests mutantes está en `audit-results.json → consola.requestsMutantes`.
- Datos crudos: `audit-results.json`. Runner: `audit-customer-ux.mjs`. Sondas: `probe-signup-trigger.mjs`, `probe-config-comercial.mjs`.

## 1 · Home: qué se ve primero (01-home-pliegue.png)

Arriba del pliegue, en este orden: header (marca **La Taba** + «Elegí tu dirección» + carrito), bloque de identidad («Tienda de bebidas · Mendoza 827, Neuquén», pastilla **«Pedidos online habilitados»**, logo), buscador, chips de categorías (se ven **Todas, Gaseosas, Aguas** + recorte de la 4ª), y la sección **«Lo más pedido · Selección del local»**.

- **Productos sobre el pliegue**: 2 tarjetas completas (Coca-Cola 2250 ml $5.900, Coca-Cola Zero 2250 ml $5.900) + 1 parcial (Red Bull, carrusel horizontal) + 2 tarjetas parciales del inicio de la sección Gaseosas (se ven los packshots x12, precio bajo el pliegue).
- **Precios sobre el pliegue: SÍ** — $5.900, $5.900 y $2.8xx visibles (6 nodos de precio medidos en la franja, 2 de ellos completos en pantalla).
- Barra inferior fija: Catálogo · Seguir · La Taba · Carrito · Perfil.
- Home completa en `02-home-completa.png`: Lo más pedido → Gaseosas (8) → Aguas (7) → Energizantes (5) → Mixers (3) → «Ver catálogo completo». Sin rastros internos (nada de PREVIEW/demo).

## 2 · Categorías y conteos

`getState().products` entrega **33 productos, todos comprables** (available=true, la compuerta del alcohol deja 0 alcohólicos). Grilla «Todos»: 33 tarjetas. Conteo por chip (clic real, `05-categoria-gaseosas.png`):

| Chip | Tarjetas | En estado |
|---|---|---|
| Gaseosas | 15 | 15 |
| Aguas | 4 | 4 |
| Isotónicas | 3 | 3 |
| Aguas saborizadas | 3 | 3 |
| Energizantes | 5 | 5 |
| Mixers | 3 | 3 |
| Destacados (virtual) | 6 | — |

En la home, «Aguas» funde aguas + saborizadas (7). **Isotónicas no tiene sección en la home** (solo chip del catálogo).

## 3 · Orden comercial (regla del dueño: 1,5L+ antes que 500 ml)

**Catálogo → Gaseosas, orden real de los primeros 10** (sort «Recomendados», por defecto):

1. Coca-Cola · Original · **2250 ml** · $5.900
2. Coca-Cola Zero · Sin azúcar · **2250 ml** · $5.900
3. Coca-Cola Original · **Pack x12 · 500 ml** · $17.100
4. Coca-Cola Zero · **Pack x12 · 500 ml** · $17.100
5. Sprite · **Pack x12 · 500 ml** · $17.100
6. Fanta Naranja · **Pack x6 · 1500 ml** · $19.999
7. Coca-Cola · **lata 354 ml** · $1.800
8. Coca-Cola Zero · **lata 354 ml** · $1.800
9. Sprite · **2250 ml** · $5.900
10. Sprite Zero · **2250 ml** · $5.900
(11–15: Sprite lata 354, Fanta 2250, Pepsi 2000, Pepsi Black 1500, 7UP 2000)

**Lectura contra la regla**: la categoría **arranca bien** (2,25L primero), pero (a) los packs de 500 ml (pos. 3–5) quedan por **encima** del pack familiar de 1,5L (pos. 6) y de 6 botellas familiares (pos. 9–15); (b) las **latas 354 ml (pos. 7–8) quedan por encima de Sprite/Sprite Zero 2,25L, Fanta 2,25L, Pepsi 2L, Pepsi Black 1,5L y 7UP 2L**. Dentro de una misma línea, la familiar siempre está arriba de su chica (Coca 2,25 > lata; Sprite 2,25 > lata), salvo Sprite: su pack 500 ml (pos. 5) está arriba de su 2,25L (pos. 9).

**Home, sección Gaseosas** (02-home-completa.png): **los packs de 500 ml van PRIMERO** — Coca-Cola Original Pack x12 500 ml, Coca-Cola Zero Pack x12 500 ml, y recién después las 2,25L, las latas 354 y Pepsi 2L/Pepsi Black 1,5L. Tomada al pie de la letra, acá la regla se viola en la vidriera principal (500 ml por encima de 2,25L existiendo ambos en la misma línea Coca-Cola).

Causa técnica: el orden por defecto es `recommendedScore` (estable); sin `featured` y con solo 2 `popular`, el resto hereda el orden de carga del catálogo, donde los 4 packs vienen primero. No hay orden comercial explícito por categoría.

## 4 · Naming en UI visible

- **Sin SKUs/slug completos** en tarjetas ni búsqueda: nombres limpios («Coca-Cola Original», «Paso de los Toros Tónica»).
- **Fuga puntual**: el tipo de envase se imprime crudo — **«botella-pet»** en la línea del carrito («Original · 2250 ml · botella-pet», `11-carrito.png`) y **«BOTELLA-PET»** en el badge de la ficha (`10-ficha-fallback.png`).
- **Duplicación** en los 4 packs: «Botella PET · 500 ml · Pack x12 · **500 ml · Botella PET**» (carrito y badge de ficha, `11-carrito.png`, `09-ficha-con-foto.png`).
- **El formato esperado «nombre / presentación / precio» está incompleto en la góndola**: 29 de 33 tarjetas del catálogo muestran variante sin litraje («Coca-Cola / Original / $5.900»). El litraje solo está en la home y en la ficha. Consecuencia medida: en la grilla, **la 2,25L ($5.900) y la lata 354 ml ($1.800) de Coca-Cola son idénticas salvo el precio** (`05-categoria-gaseosas.png`), y la búsqueda «coca» devuelve pares indistinguibles.

## 5 · Búsqueda

- **«coca»** → 6 resultados, todos Coca-Cola (correcto; con los pares indistinguibles ya señalados). `06-busqueda-coca.png`
- **«cerveza»** → 0 resultados con estado vacío digno: «No encontramos “cerveza”. Probá con la marca o la presentación» + Limpiar/Ver todo. Coherente con el LICENSE GATE (alcohol no publicado). `07-busqueda-cerveza.png`
- **«agua»** → 7 resultados razonables (4 aguas + 3 Aquarius). `08-busqueda-agua.png`

## 6 · Ficha de producto

- **Con foto** (pack Coca-Cola 500x12): packshot real, nombre, presentación, precio, «Disponible», observación opcional, Agregar / Guardar para después. Completa. `09-ficha-con-foto.png`
- **Sin foto** (Coca-Cola 2,25L): placeholder TABA propio y honesto (`aria-label`: «Producto sin imagen oficial: Coca-Cola»), badge «Más pedido», descripción humana «Coca-Cola en botella PET de 2,25 L.», precio, disponible. `10-ficha-fallback.png`
- 0 imágenes rotas en todo el recorrido.

## 7 · Carrito y checkout (sin confirmar)

Agregados 2 productos (Coca-Cola 2,25L + pack Coca-Cola Original 500x12). `11-carrito.png`, `12-checkout-medios-pago.png`, `13-checkout-resumen.png`:

- 2 líneas correctas con stepper; aviso vivo «Coca-Cola Original agregado al pedido»; badge del carrito = 2.
- **Subtotal $23.000 = 5.900 + 17.100 ✓** · «Envío a domicilio **$ 0**» · **Total $23.000**.
- **Mínimo de pedido: no se muestra ninguno** — coherente: el módulo resuelve mínimo 0 y fee 0 para esta sesión (`probe-config-comercial.mjs`).
- **Medios de pago listados**: «A coordinar con el local» (default) y «Efectivo al recibir». **Mercado Pago no aparece** (RPC de disponibilidad responde que no está configurado — esperado, MP sigue en TEST).
- **«Retiro en local» está deshabilitado** (el radio existe `disabled` y no se dibuja): el cliente solo ve Delivery.
- Compuertas antes de confirmar: «Completá tu perfil para continuar» y «Agregá una dirección en Perfil». El botón dice «Confirmar pedido» — **no se tocó**.

## 8 · Imágenes (33 visibles)

- **4/33 con packshot real** (`image` en estado + `.thumb.has-photo`): los 4 packs del sistema Coca-Cola (Original 500x12, Zero 500x12, Sprite 500x12, Fanta 1500x6).
- **29/33 con fallback TABA** honesto y anunciado por `aria-label`. DOM y estado coinciden exactamente.

## 9 · Consola y red (recorrido completo)

- **0 errores de consola, 0 pageerrors, 0 requests fallidos, 0 respuestas ≥400, 0 imágenes rotas.**
- Requests no-GET observados: 4 RPC de **lectura** (`commerce_availability` x2, `get_public_business_contact`, `get_mercadopago_checkout_availability` — POST por forma, no por efecto) y **1 `POST /auth/v1/signup` que disparó la app sola** (ver hallazgo A1).

---

# Hallazgos

## P0 — impide vender hoy
**Ninguno.** El embudo funciona de punta a punta para lo que un anónimo puede hacer: catálogo carga (33/33), precios visibles desde el pliegue, carrito correcto, checkout se abre con 2 medios de pago y el negocio se anuncia abierto. Cero errores técnicos.

## P1 — corregir antes de hacer publicidad

**A1 · Abrir el carrito crea una identidad anónima permanente en `auth.users` por visitante.**
Medido con `probe-signup-trigger.mjs`: home → nada; catálogo → nada; **agregar al carrito → nada** (es memoria del navegador, como se afirma); **abrir la vista carrito → `POST /auth/v1/signup`**. Cadena: `js/app.js:594/2114/2139` (entrar a `cart` refresca disponibilidad de MP) → `js/repositories/supabase_order_repository.js:915` `getMercadoPagoCheckoutAvailability()` llama `auth.ensureCustomerSession()` con el default `createIfMissing: true` → identidad anónima. Contradice la doctrina documentada del propio código (`js/services/supabase-auth.js:49-63`: «la identidad se crea cuando la persona guarda algo»; el mismo defecto ya se corrigió una vez en el arranque). Con pauta encendida, cada curioso y cada bot que ejecute JS deja una fila permanente (y los usuarios anónimos cuentan para el MAU de Supabase: costo, con el techo de USD 25 documentado). Fix candidato: `ensureCustomerSession({ createIfMissing: false })` para la consulta de disponibilidad, o exponer la RPC al rol `anon`.
*Transparencia: esta auditoría dejó 2 de esas filas (una por corrida que abrió el carrito) — es exactamente el defecto midiéndose; no se escribió nada más.*

**A2 · La góndola no dice el tamaño: 29/33 tarjetas sin litraje.**
«Coca-Cola / Original / $5.900» (2,25L) y «Coca-Cola / Original / $1.800» (lata 354) son la misma tarjeta salvo el precio; la búsqueda «coca» devuelve los pares indistinguibles. La home sí muestra «2250 ml» y la ficha también — la grilla, donde se decide la compra, no. Riesgo directo de pedido equivocado y reclamo en la entrega.

**A3 · Orden comercial: la regla del dueño no se cumple completa.**
Catálogo→Gaseosas arranca con 2,25L (bien), pero latas 354 ml quedan por encima de 6 botellas familiares y los packs 500 ml por encima del pack 1,5L; y en la **home** la sección Gaseosas abre con los packs de 500 ml por encima de las 2,25L de la misma línea. No existe orden comercial explícito (featured/orden por categoría): hoy manda el orden de carga del catálogo. Decisión de dueño + orden explícito antes de pauta.

## P2 — cosmético / a validar

- **B1** Slug de envase visible: «botella-pet» (carrito) / «BOTELLA-PET» (badge de ficha).
- **B2** Presentación duplicada en los 4 packs: «…Pack x12 · 500 ml · Botella PET» repite tamaño y envase.
- **B3** «Envío a domicilio $ 0» y sin mínimo: coherente con la config actual (fee 0, mínimo 0), pero validar con el dueño que el envío gratis es intencional antes de publicitarlo; y «Retiro en local» está deshabilitado — confirmar que es la intención (el copy del mínimo de delivery, si se activara, ofrece «también podés elegir retiro» que hoy no se puede elegir).
- **B4** Isotónicas (3 SKU) sin sección en la home; nombres largos truncados en tarjetas de home («Villavicencio Sin…», «Paso de los Toros…»).
- **B5** Búsqueda «cerveza» vacía sin explicación de licencia — es la decisión vigente del LICENSE GATE; anotado como comportamiento esperado, no defecto.

## Capturas

| # | Archivo | Qué muestra |
|---|---|---|
| 01 | 01-home-pliegue.png | Pliegue exacto 390x844 |
| 02 | 02-home-completa.png | Home completa (orden de secciones) |
| 03/04 | 03-catalogo-todos.png / 04-catalogo-completo.png | Grilla 33, 4 packshots vs 29 fallback |
| 05 | 05-categoria-gaseosas.png | Gaseosas: 2,25L sin litraje en tarjeta |
| 06–08 | 06/07/08-busqueda-*.png | coca / cerveza (vacío digno) / agua |
| 09/10 | 09-ficha-con-foto.png / 10-ficha-fallback.png | Fichas; badge BOTELLA-PET |
| 11 | 11-carrito.png | Líneas, slug botella-pet, duplicación pack |
| 12 | 12-checkout-medios-pago.png | Solo Delivery; compuertas Perfil/dirección; medios de pago |
| 13 | 13-checkout-resumen.png | Subtotal/Envío $0/Total; «Confirmar pedido» (no tocado) |
