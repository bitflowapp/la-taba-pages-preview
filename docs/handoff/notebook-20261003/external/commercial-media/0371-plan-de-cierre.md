# Plan de cierre — Storefront TABA2 / La Taba 2

Base: `integration/taba2-mobile-design-review` @ `08bb17a0`. **Nada de esto está implementado: es propuesta.** Máximo tres tandas, cada una con su gate de pruebas. Regla transversal: no inventar precios, stock, descuentos, ETA ni promesas; no tocar Panel, RC, backend, Supabase, migraciones, Mercado Pago, ARCA, Rider, imágenes ni identidad.

**Paralelo (no-código, dueño: negocio):** carga de precios/stock reales de los 62 productos pendientes y publicación de horarios, zona, WhatsApp (RPC) y medios de pago — ya inventariado en `docs/final-commercial-release/remaining-external-data.md`. Ninguna tanda depende de esto; cada dato que llegue enciende superficie sola.

---

## TANDA 1 — Fugas comerciales (P1)

**Objetivo:** que ninguna puerta de la vidriera termine en una góndola vacía y que el tap de pagar valide antes de vender más.

| # | Cambio | Archivos probables | Pantallas |
|---|---|---|---|
| 1.1 | CTA "Ver todos" de Destacados deja de apuntar a `popular` (sin datos) y apunta a `all` — o a un filtro real "destacados" con los mismos 8 SKUs del rail | `index.html:294`; fallback de título `js/ui.js:1592` (si se crea filtro: `js/ui.js:1517-1518`) | Home → Catálogo |
| 1.2 | Banners e historias adoptan el criterio del hero: se pintan solo si el destino tiene **al menos un producto comprable** (precio publicado + disponible + stock). Hoy apaga: banner whisky, banner fernet, historia Jack Daniel's; conserva: banner de marca Heineken e historias de cervezas/energizantes/mixers. Reaparecen solos al publicarse precios | Elegibilidad de banners `js/ui.js:741-778`; filtro en `getHomeStories` `js/ui.js:866-875` (predicado compartido con `js/ui.js:997-1016`) | Home, Historias |
| 1.3 | La compuerta de sugerencias corre **después** de `validateCartForCheckout`: pedido inválido → error directo, nunca modal. Además: mostrar solo si el rail no fue usado y ordenar sugerencias por precio ascendente (alternativa válida y más simple: retirar el modal y dejar el rail, que ya cumple) | `js/app.js:1437-1441`; `js/core/cart-recommendations.js:31-51`; `js/ui.js:2190-2200` | Carrito/Checkout |

- **Pruebas:** `npm run check` · `npm test` (unitarias focales; agregar casos: elegibilidad de banner/historia con categoría sin comprables; orden de compuerta) · `npx playwright test` Chromium (37 contratos; actualizar invariantes de `tests/e2e/taba2-brand-home.spec.mjs` que cuenten banners/historias) · barrido visual 320/390/432 de home e historias.
- **Riesgo:** bajo. 1.1 es un atributo; 1.2 endurece un predicado ya testeado; 1.3 reordena una compuerta con marcador de sesión existente. Sin cambios de datos, estilos ni contratos visuales.
- **Criterio de aceptación:** (a) ninguna CTA/banner/historia de la home lleva a un destino con 0 comprables; (b) "Ver todos" de Destacados nunca rinde "0 productos" con catálogo no vacío; (c) con pedido inválido, el primer tap de Confirmar muestra el error de validación y ningún modal; (d) suite Chromium verde.
- **Commits sugeridos (3):**
  1. `home: "Ver todos" de Destacados apunta a catálogo real, no a popular vacío`
  2. `home: banners e historias exigen destino con producto comprable (criterio del hero)`
  3. `checkout: validar el pedido antes de la compuerta de sugerencias; sugerencias por precio asc`

---

## TANDA 2 — Claridad y consistencia (P2 de copy/lógica)

**Objetivo:** que ningún texto hable en jerga, que ningún aviso desaparezca y que la marca del local sea una sola frente al cliente.

| # | Cambio | Archivos probables | Pantallas |
|---|---|---|---|
| 2.1 | Bug del aviso: `clearCheckoutInlineError` y `renderOrderSummary` usan el **mismo** mecanismo de ocultamiento (propiedad *o* clase) para `[data-checkout-warning]` | `js/app.js:879` ↔ `js/ui.js:2304-2310` | Checkout |
| 2.2 | Filtros: etiquetas humanas de presentación (Botella, Botella PET, Lata, Unidad), capacidades ordenadas por ml normalizados y unidad de display consistente (≥1 L → "1,5 L"). Solo presentación; cero cambios de datos | Construcción de opciones `js/ui.js:1459-1478` | Catálogo → Filtros |
| 2.3 | Política de nombre frente al cliente: `businessName` en copys dirigidos a la persona ("TABA no necesita tu DNI" → "La Taba 2 no necesita tu DNI"; "Entrega TABA2"/"Rider TABA2" → neutro "Entrega del local"/"Repartidor"); TABA2 queda en título, manifiesto y chrome de plataforma | `js/customer-profile-view.js:413`; `js/ui.js:2684-2711`; revisar `index.html:106,140-163` | Perfil, Tracking, banners PWA |
| 2.4 | Subtítulo de "Destacados" distinto de "Selección del local" (p. ej. "Los más pedidos del local") | `js/ui.js:1085` | Home |
| 2.5 | CTA de historias con destino concreto ("Ver cervezas") + cierre por tap en el fondo del visor (paridad con los demás modales) | `js/core/stories.js:33-38`; cierre en `js/ui.js` / `js/app.js:1598-1622` | Historias |

- **Pruebas:** `npm run check` + unitarias (agregar: regresión del bug 2.1 —error inline limpiado no oculta el aviso vivo—; orden/etiquetas de filtros) + e2e Chromium + lectura de copys en 320/390.
- **Riesgo:** bajo-medio — 2.3 toca strings que pueden estar fijados en specs de copy: actualizar en el mismo commit. 2.1 es quirúrgico pero está en el camino del dinero: sumar el caso de regresión antes del cambio.
- **Criterio de aceptación:** el aviso de mínimo es visible siempre que el carrito esté bajo mínimo en delivery; ningún slug visible en filtros; una sola marca frente al cliente; suite verde.
- **Commits sugeridos (3):** `checkout: el aviso de mínimo no desaparece tras limpiar un error` · `catalogo: filtros con etiquetas humanas y capacidades ordenadas` · `marca: nombre del local en copys de cliente; CTA de historias con destino`.

---

## TANDA 3 — Pulido y accesibilidad (P2 restantes + P3)

**Objetivo:** cerrar los detalles que separan "muy bueno" de "impecable", sin tocar nada aprobado.

| # | Cambio | Archivos probables | Pantallas |
|---|---|---|---|
| 3.1 | Foco visible en radios Delivery/Retiro: regla `:focus-visible` en el `span` hermano (espejo de la de variantes `styles/checkout.css:337-340`) | `styles/checkout.css:419-422` | Checkout |
| 3.2 | Errores de checkout hacia controles perceptibles: mapear a la tarjeta "Tus datos"/CTA "Completar Perfil", radiogroup de direcciones y checkbox de edad en vez de inputs `hidden` (hoy `aria-invalid` no llega a nada perceptible). Importante para producción con perfil vacío | `js/app.js:850-913` | Checkout |
| 3.3 | Compactación vertical solo < 360 px para acercar el primer producto al pliegue de 568 (hero/bienvenida/paddings; sin reordenar bloques del contrato §2b) | `styles/brand-home.css`, `styles/responsive.css` (media queries existentes 360/560) | Home 320 |
| 3.4 | Toast: offset para no tapar título/acciones al entrar a una vista (o posición inferior sobre la nav) | `styles/common.css`; `js/ui.js:3217-3224` | Global |
| 3.5 | Menores: nombre accesible + 44 px del buscador desktop (`index.html:106-111`); franja de categorías del catálogo con `aria-label` (paridad con home, `index.html:402`); microcopys 9–10 px → ≥ 11 px donde no rompa layout; unificar anillo de foco de inputs con el outline de marca | `index.html`, `styles/responsive.css`, `styles/tokens.css` | Global |

- **Pruebas:** `npm run check` + unitarias + e2e Chromium + **spec e2e nuevo para 3.2** (con perfil vacío: primer error enfoca un control visible con `aria-invalid`) + verificación manual de foco por teclado en checkout + re-medición de pliegue a 320/432 tras 3.3 (el contrato de 432 no debe regredir).
- **Riesgo:** medio en 3.2 (camino crítico del dinero — hacerlo al final, con su spec); bajo en el resto. 3.3 exige re-verificar el contrato visual del spec de marca.
- **Criterio de aceptación:** foco visible en el 100 % del checkout por teclado; primer error de producción enfoca un control perceptible; a 320 hay al menos un precio sobre el pliegue sin alterar el orden de bloques; 432 sigue cumpliendo su contrato actual; suite verde.
- **Commits sugeridos (3):** `checkout: foco visible en modalidad y errores hacia controles perceptibles` · `home 320: primer producto sobre el pliegue sin reordenar bloques` · `pulido: toast, nombres accesibles, microcopys y foco de inputs`.

---

## Qué NO entra en ninguna tanda

Hero y su título · paleta/tokens · orden de bloques de la home · modelo perfil-primero del checkout · tratamiento "Precio próximamente" · tracking honesto · imágenes y contenido comercial · arquitectura/contratos · dependencias nuevas · cualquier dato inventado.

## Secuencia y esfuerzo estimado

Tanda 1: ~medio día + gate. Tanda 2: ~medio día + gate. Tanda 3: ~1 día (3.2 concentra el riesgo) + gate. Cada tanda es shippeable por separado; si solo se hace una, que sea la 1 — es la que convierte la demo en demo vendible.
