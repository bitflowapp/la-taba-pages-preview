# Candidata cliente: comercial endurecido + mapa permanente

Integración de `36b6f3d` (`feature/taba2-tracking-always-on-map`) sobre
`b0d53ca` (endurecimiento comercial del storefront). Las dos ramas salen de
`eda13f8`, así que el merge tiene un solo ancestro común y ninguna rebase.

```
eda13f8  base común (release/taba2-pilot-rc2-operational)
├── b0d53ca  storefront comercial endurecido  (carrito, fallbacks, copy, rutas, cache busting)
└── 36b6f3d  «Seguir» como mapa permanente
        └── HEAD  merge de los dos
```

## Los conflictos: cuáles hubo y cómo se resolvieron

**Textuales: ninguno.** Las dos ramas resultaron disjuntas archivo por archivo
—`36b6f3d` no toca `js/app.js`, `sw.js`, `index.html`, `styles.css` ni
`js/state.js`—, así que `git merge` no pidió resolver nada. Eso NO quiere decir
que la integración fuera automática: lo que había que resolver era semántico y
no aparece como marcador de conflicto.

### 1 · `js/app.js` — enrutado nuevo contra mapa permanente

No hubo que elegir: `36b6f3d` no toca el archivo, así que `resolveRoute` queda
intacto y `normalizeView` no se restauró en ninguna forma. Lo que sí había que
verificar es que el enrutado no rompa el montaje del mapa, porque
`recoverFromUnservedRoute` corre ANTES del corte por «no cambió la vista» en
`syncViewFromLocation`.

Verificado en los cuatro estados y en los dos motores: entrar a `#tracking`
—por barra inferior, por hash o por navegación directa— deja **un** mapa
montado, y el lienzo vivo es **el mismo nodo** a lo largo de idle → preparing →
on_the_way → delivered. `tracking` sigue resolviendo como ruta `ok`, así que la
corrección de URL nunca se dispara sobre ella.

### 2 · `sw.js` — unión de listas

`36b6f3d` no agrega módulos nuevos: modifica `map_view.js`,
`maplibre_tracking_map.js` y `ui.js`, los tres ya precacheados. O sea que la
"unión" no perdía nada de esa rama.

Pero al verificarlo con un guard nuevo apareció otra cosa: **17 imports
estáticos del grafo del cliente nunca habían estado en la lista**, en ninguna de
las dos ramas ni en la base. Sin red, el navegador no puede resolver un import
estático que no está en la caché: la aplicación no se degrada, **no arranca**.
Con el worker en network-first el defecto es invisible mientras haya señal.

Los 17: `back-office.js`, `motion.js`, `combos-data.js`,
`preview-promotions-data.js`, `preview-stories-data.js`,
`core/beverage-home-sections.js`, `core/business-order-intake.js`,
`core/combos.js`, `core/customer-delivery-address-hydration.js`,
`core/profile-checkout.js`, `core/purchasable-destination.js`,
`core/retail-packaging.js`, `core/sandbox-tracking-presentation.js`,
`payments/mercadopago-checkout.js`,
`repositories/sandbox_customer_profile_repository.js`,
`repositories/sandbox_order_repository.js`,
`tracking/customer_tracking_poll.js`.

`scripts/check-precache-graph.mjs` recorre el grafo desde las tres entradas de
`index.html`, compara contra `ASSETS` y **ahora corre dentro de `npm run
check`**. También verifica lo inverso —una entrada que apunte a un archivo
inexistente rompe `cache.addAll()` y deja al worker sin instalar nunca—.

Estado final: **88 módulos del grafo estático, todos en el precache**, más CSS,
manifiesto, íconos y `runtime-config.js`.

`CACHE_NAME` final: **`la-taba-runtime-v61-cliente-comercial-mapa-permanente`**.
Subido **una sola vez** desde el `v60` que hoy sirve staging.

### 3 · Cache busting

Regla aplicada: cada punto de entrada versionado recibe **exactamente un salto**
desde lo desplegado, y los bytes detrás de ese número son los finales de la
candidata.

| Asset | Desplegado | Candidata | Cambió |
|---|---|---|---|
| cadena CSS (`styles.css` + 12 hojas) | `?v=48` | **`?v=49`** | sí — `common.css` (comercial) + `tracking.css` y `responsive.css` (mapa) |
| `js/app.js` | `?v=40` | **`?v=41`** | sí — comercial |
| `js/startup-recovery.js` | `?v=1` | **`?v=2`** | sí — comercial |
| `js/pwa-update.js` | `?v=3` | `?v=3` | no |

No quedan versiones cruzadas: `index.html`, `styles.css` y `sw.js` coinciden en
los cuatro valores, y ningún número apunta a bytes previos al merge. No se
volvió a subir el CSS por el merge porque `v=49` nunca se desplegó — el número
identifica el contenido final, no una etapa intermedia.

### 4 · Tests de tracking

No se restauró ninguna assertion vieja. El contrato vigente es el de `36b6f3d`
—**mapa presente siempre + datos nunca inventados**— y las seis suites que
afirmaban «sin GPS real no hay mapa» quedan como esa rama las dejó. La única
edición que hice en su territorio fue quitar dos rutas de disco local del
handoff, que hacían fallar la higiene de release del repositorio integrado.

## Regresión crítica

`scripts/taba2-candidata-cliente-regresion.mjs`, cuatro anchos × dos motores.

| | Verificación | Resultado |
|---|---|---|
| **A** | cliente nuevo, sin pedidos → Seguir | mapa visible ya, 0 rider, barra presente, estado `idle` |
| **B** | agregar producto → recargar | carrito 2 → 2 |
| **C** | catálogo 503 | carrito NO se vacía — `production-cart-persistence.spec.mjs`, los dos motores |
| **D** | producto deja de venderse | reconciliación lo elimina — mismo spec, incluye sin stock, sin precio y fuera de catálogo |
| **E** | arranque demorado / caído | demorado: sin cartel · caído: salida visible, 0 código interno, 0 HTML crudo, 0 pantalla blanca |
| **F** | ruta inválida | URL corregida a `#home` + aviso comercial |
| **G** | Seguir en idle / preparing / on_the_way / delivered | mapa visible en los cuatro, **un solo lienzo**, barra en los cuatro |

Y en cada estado: **0 overflow · 0 CTA tapado (hit test real) · 0 errores de
consola inesperados · 0 respuestas 4xx/5xx inesperadas · 0 rider fantasma ·
mapa montado una sola vez · barra inferior visible en Seguir**.

Dos mediciones que hubo que corregir para que dijeran la verdad:

- **«Montado una sola vez» se mide por identidad del nodo, no contando
  inserciones.** `renderWithStableRealMap` reescribe el HTML del contenedor y
  después trasplanta de vuelta el lienzo vivo; el markup intermedio se inserta y
  se descarta sin recibir jamás una instancia de mapa. Contar inserciones daba
  ocho y no significaba nada. Medido por identidad: `[1, 1, 1, 1]`.
- **El lienzo toma caja un frame después de entrar la sección.** Medir a ciegas
  a los 1,6 s daba un falso negativo en WebKit a 432 px. Ahora se espera a que
  la tome, con techo de 4 s: si no la toma, sigue siendo una falla.

Confirmado estable: tres corridas de WebKit y dos de Chromium, sin fallas.

Nota honesta sobre `on_the_way`: el arnés siembra el estado del pedido y **no**
inyecta GPS, así que no aparece marcador de rider. Eso es el contrato de
honestidad funcionando —sin fix real no se dibuja rider—; el camino con GPS lo
cubren `tracking-follow-mode.spec.mjs` y la suite de la rama del mapa.

## Gates

| Gate | Resultado |
|---|---|
| `npm run check` (ahora con el guard de precache) | ✅ |
| `npm test` | ✅ **1324/1324** (1308 comercial + 16 del mapa permanente) |
| Playwright chromium | ✅ **246/246** |
| Playwright mobile-webkit | ✅ **19/19** |
| Responsive storefront 320/360/390/432 | ✅ **0/44** chromium · **0/44** webkit |
| Regresión A–G 320/360/390/432 | ✅ sin fallas, chromium y webkit |

## Capturas

```
artifacts/taba2-candidata-cliente/{chromium,webkit}/{320,360,390,432}/
  01-home · 02-seguir-sin-pedido · 03-carrito · 04-perfil · 05-ruta-invalida
  06-seguir-{idle,preparing,on_the_way,delivered} · 07-arranque-{demorado,caido}
```

88 PNG. **`02-seguir-sin-pedido`** es la que pedía el encargo: cliente nuevo,
sin pedidos, mapa sobre el local con el pin del comercio, sin rider, sin ETA
inventada, barra inferior presente y una tarjeta que dice qué va a pasar cuando
haya una compra.

## Lo que sigue, y no se tocó

- **Los 124,5 KB de mapa y tracking que bajan en el inicio** siguen bajando. Es
  la optimización separada, después de certificar esta candidata, y ahora tiene
  las dos mitades en el mismo árbol para poder hacerse.
- Sin backend, sin Rider, sin auto-dispatch, sin deploy, sin push.
