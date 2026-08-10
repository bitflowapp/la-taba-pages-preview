# Candidata integrada — la vidriera y el mapa en un solo cliente

Rama `integration/taba2-customer-experience`, en su propio worktree bajo el
directorio de worktrees del proyecto. La punta exacta al cerrar queda anotada
en el lock (`_claude-locks/taba2-customer-experience-integration.txt`): un
documento no puede nombrar su propio commit sin mentir.

Junta dos encargos cerrados y certificados por separado:

| | rama | HEAD integrado | base |
|---|---|---|---|
| catálogo | `feature/taba2-catalog-premium-purchase` | `280213d` | `e59ac1c` |
| seguimiento | `feature/taba2-live-tracking-production-ux` | `73fdb4c` | `da56ce9` |

> **Nota de la punta del seguimiento.** El encargo nombraba `5941279`, y ése fue
> el merge inicial. Durante la integración esa rama avanzó a `73fdb4c` con dos
> commits que tocan ÚNICAMENTE `INFORME-TRACKING-EN-VIVO.md` (cero código de
> producto: verificado con `git diff --stat`). Se trajeron igual, para que la
> candidata quede sobre la punta real y no sobre una foto vieja.
> En el mismo período **el seguimiento se desplegó a staging**: lo que
> `taba2-staging.pages.dev` sirve hoy ya no es `da56ce9`/v55 sino v56. La
> auditoría de caché de la sección 3 se rehízo contra esa realidad.

---

## 1. La ancestría, antes de tocar nada

```
da56ce9  release/taba2-commercial-candidate   ← lo que staging sirve hoy
   ├── e59ac1c  feature/taba2-digital-commerce-100      (base canónica del encargo)
   │      └── 280213d  catálogo premium        (4 commits)
   └── 5941279  seguimiento en vivo            (4 commits, sale DIRECTO de da56ce9)
```

`git merge-base` de las dos ramas da exactamente `da56ce9`. O sea que el
catálogo ya trae `e59ac1c` adentro y el seguimiento no: la candidata contiene
las tres líneas y **ninguna ajena**. No entró `59d8e03`
(`fix/taba2-order-intake-dispatch`) ni sus cinco migraciones sin aplicar.

La integración se hizo con un merge de verdad —`5993f4f` tiene los dos padres—,
no aplastando una rama sobre la otra.

## 2. Los conflictos, resueltos por lo que hace cada cambio

La superficie compartida fue exactamente la anunciada: `index.html`,
`js/app.js`, `js/ui.js`. Git resolvió solo los dos JS; **eso no alcanza como
prueba**, así que se verificó a mano qué tocó cada rama en cada archivo:

| | el catálogo tocó | el seguimiento tocó |
|---|---|---|
| `js/ui.js` | `renderHomeShowcase`, `renderHomeHeroPromo`, `getHomeStories`, `renderStoryEntry`, `renderHomePromotions`, `railCard`, `renderProducts`, `renderCartList`, `quickAddControl`, `unitText` | `trackingRecenterButton` (+ `trackingFollowCta`) |
| `js/app.js` | catálogo y carrito | el selector de recentrado |

Cero solape de funciones. La búsqueda cruzada lo confirma: el diff del catálogo
no menciona una sola vez `tracking`, `map`, `rider`, `recenter` ni `follow`; el
del seguimiento no menciona `cart`, `home`, `hero`, `categor` ni `product`.

**El único conflicto textual fue `index.html`**, y las dos ramas pedían cosas
distintas del mismo `<head>`: el catálogo agrega el `preload` de la banda del
hero —es el LCP, y la derivada de 35 KB es lo que compra los 1.052 ms—, el
seguimiento rota `styles.css`. Se quedan las dos. No era elegir una rama.

## 3. Service worker: un bump, y un defecto que el bump destapó

Bump único: `CACHE_NAME` **v56 → v57-vidriera-y-seguimiento**, hojas de estilo
**?v=46 → 47**, `js/app.js` **?v=39 → 40**.

Y una corrección que no es cosmética. **El `?v` de `styles.css` no protege a lo
que `styles.css` importa**: cada `@import` es su propia URL con su propio `?v`.
La rotación a v46 movió `index.html` y `sw.js` y dejó los TRECE `@import` en
v45. Con caché encima —el caso del cliente que vuelve— el navegador pedía
`styles/brand-home.css?v=45`, una URL que ya tenía cacheada con el contenido
viejo: HTML y JS nuevos con el CSS anterior, que es exactamente lo que el `?v`
existe para impedir. Toca a las cinco hojas que esta candidata cambia
(brand-home, catalog, motion, responsive, tracking). Online no se nota porque
el fetch handler es network-first y siempre trae la hoja fresca: por eso pasó
las suites verdes.

Segundo agujero, más viejo, encontrado por el mismo guard: **`styles/motion.css`
se importa desde `styles.css` y nunca estuvo en el precache** —ni en v55, ni en
v45, en ninguna revisión—. Sin red la home perdía su capa de movimiento.

El guard nuevo en `tests/pwa.test.mjs` afirma las dos puntas de la cadena: que
shell, `@imports` y precache digan la MISMA versión, y que toda hoja importada
esté precacheada en esa versión. Las suites comparaban literales contra `sw.js`
e `index.html`, y nunca contra lo que `styles.css` pide de verdad.

### La actualización, medida sobre un mismo origen

Arnés en `artifacts/.../upgrade-sw.mjs`: un servidor que cambia su raíz de
documentos a mitad de la corrida, que es lo que le pasa a un cliente cuando se
publica. **Del v56 que sirve staging hoy** al v57 de esta candidata.

De paso, el paso 1 de esa corrida confirma que el defecto de las hojas **está
vivo en staging ahora mismo**: el shell publicado va en `styles.css?v=46` y sus
trece `@import` piden `?v=45`.

**La cabecera del servidor decide el resultado**, así que se midieron las dos
reales el 2026-08-10:

| destino | `Cache-Control` medido | primera visita tras publicar |
|---|---|---|
| staging · Cloudflare Pages | `public, max-age=0, must-revalidate` | **arranca entera**: `ready`, 99 productos, 0 errores |
| GitHub Pages · `bitflowapp.github.io/la-taba-pages-preview` | `max-age=600` | **NO arranca**: 0 productos, `SyntaxError` |

En los dos casos, después de «Actualizar ahora»: una sola caché
(`la-taba-runtime-v57-vidriera-y-seguimiento`), cero recursos con `?v` anterior,
los 13 `@import` en v47 y con reglas, y sin red la home se pinta con las 13
hojas. **El objetivo del encargo —que no se mezclen JS/CSS viejos— se cumple.**

Lo de GitHub Pages es otra cosa y está en la sección 6: es un bloqueante abierto.

## 4. Regresión cruzada

`artifacts/.../regresion-cruzada.spec.mjs`, 4/4 en 320/360/390/432, Chromium.
Los dos recorridos corren **en la misma sesión y sobre el mismo estado**, que es
lo único que ninguna de las dos suites de origen podía probar.

Recorrido A: home (hero + 2 historias) → historia → su CTA a la categoría →
producto → carrito (2 items) → recarga → **el carrito sobrevive**.
Después, en la misma página: checkout con la puerta de edad → pedido → rider en
camino → tracking con «Ubicación en vivo · ahora» y cámara en `follow` → gesto →
«Volver al Rider» (40 px de alto, dentro del mapa, en las cuatro anchuras) →
señal caída: «Sin conexión · última ubicación hace 2 min» **sin borrar el
marcador ni apagar el mapa** → reconexión: vuelve a «Ubicación en vivo · ahora»
→ y de vuelta a la home, con las historias intactas.

Desborde horizontal máximo en los 56 puntos medidos: **0 px**. Cero errores de
página y cero respuestas ≥400.

Suite completa: `npm run check` verde · `npm test` **1258/1258** ·
`npx playwright test` **230/230** (Chromium + WebKit móvil).

## 5. Performance

Arnés A/B del catálogo, reusado: mismo host, iPhone 13, 4G emulada, CPU a 1/4,
5 corridas alternadas, mediana.

**Contra `e59ac1c`, la base canónica:**

| métrica | e59ac1c | candidata | |
|---|---:|---:|---|
| LCP | 6012 ms | **5448 ms** | −564 (−9 %) |
| bloqueo de hilo | 1533 ms | 1386 ms | −147 (−10 %) |
| peso de imágenes | 910 KB | **843 KB** | −67 (−7 %) |
| JavaScript | 2040 KB | 2076 KB | +36 (+2 %) |
| módulos | 129 | 131 | +2 |
| FCP | 1488 ms | 1596 ms | +108 (+7 %) |
| 1er producto comprable | 5034 ms | 5152 ms | +118 (+2 %) |

**Contra el catálogo solo (`280213d`) — el control que importa:**

| métrica | catálogo | candidata | |
|---|---:|---:|---|
| LCP | 5496 ms | 5524 ms | +28 (+1 %) |
| FCP | 1620 ms | 1588 ms | −32 (−2 %) |
| 1er producto comprable | 5155 ms | 5197 ms | +42 (+1 %) |
| JavaScript | 2052 KB | 2076 KB | **+24 (+1 %)** |
| imágenes / CLS | idénticos | idénticos | 0 |

**La integración no perdió las mejoras del catálogo.** Todo cae dentro del
ruido salvo los +24 KB, que son deterministas (variación cero entre corridas) y
tienen nombre:

```
+11,0 KB  js/map/rider_motion.js        (nuevo)
 +6,0 KB  js/map/maplibre_tracking_map.js
 +3,6 KB  js/map/tracking_status.js     (nuevo)
 +2,3 KB  js/map/map_view.js
```

Es el motor de movimiento del seguimiento: código de producto que el encargo
pide preservar. Importante para no acusar a la integración de algo que no hizo:
`maplibre_tracking_map.js` y `map_view.js` **ya se cargaban en la home** en
`e59ac1c` (28,1 y 13,6 KB). El seguimiento no arrastró una capa nueva al
arranque: engordó una que ya estaba.

Sobre la línea completa, contra lo que sirve staging (`da56ce9`), la
transformación de `e59ac1c` (−562 KB de JS, −1.398 ms al primer producto) sigue
casi entera: se devuelve un 6 % del ahorro de JavaScript y un 8 % del de tiempo.

Las diferencias entre las dos tablas contra `e59ac1c` son deriva del host entre
sesiones, no del código: el mismo `e59ac1c` midió 6012 ms de LCP en esta sesión
y 6764 ms en la del catálogo. Por eso el control válido es el pareado.

## 6. Deuda y lo que NO se hizo

**BLOQUEANTE para publicar en GitHub Pages — no para staging.**
El grafo de módulos ES no lleva `?v`: `index.html` pide `js/app.js?v=40`, URL
nueva, pero ese módulo importa `./ui.js`, URL sin versión. Con `max-age=600` el
navegador puede servir el `ui.js` VIEJO desde su caché HTTP sin preguntar, y
como el catálogo **agregó un export** (`clearAddedFlash`), el grafo no linkea:
`SyntaxError` y la tienda no arranca —0 productos— hasta que el cliente toca
«Actualizar ahora». Medido, no supuesto. Antes este mecanismo sólo servía CSS
rancio y se curaba solo; el export nuevo lo vuelve fatal.
Con las cabeceras de staging (`must-revalidate`) **no ocurre**: verificado.
No se corrigió acá a propósito: la corrección natural —que el fetch handler
revalide los módulos— cambia la semántica de caché de todas las peticiones y
tiene un costo de performance que este encargo pide explícitamente no pagar a
ciegas. Necesita su propia medición.

**Sin probar en el navegador:** que el gesto de dos dedos suspenda el
seguimiento. MapLibre monta con `cooperativeGestures` y Playwright no sintetiza
multi-touch; Ctrl+rueda tampoco alcanzó (medido: la cámara se quedó en `follow`
en las cuatro anchuras, con canvas de MapLibre real y sin respaldo estático).
Queda cubierto por el doble de MapLibre en `tests/map.test.mjs` y pendiente de
prueba física.

**Smoke físico pendiente.** El Moto G15 está tomado por
`TABA2_CUSTOMER_LIVE_TRACKING_PRODUCTION_UX`, el propio encargo del
seguimiento. No se desplazó a nadie y no se bloqueó la integración.

**Anotado, no tocado:** 22,9 KB de código de mapa se descargan en la home, donde
no hay mapa. Es anterior a esta candidata (`e59ac1c` ya cargaba 41,7 KB de esa
capa) y arreglarlo es diferir el grafo del mapa: un cambio de arquitectura, no
una integración.

**Anotado:** la banda del hero (`assets/promos/cervezas-heineken-band.webp`) no
está en el precache. Ninguna imagen de `assets/promos/` lo está: se respetó la
convención existente en vez de inventar una excepción.

**Reglas respetadas:** worktree aislado, sin push, sin tocar staging, ni
producción, ni LT-0030, ni ARCA/WhatsApp/Rider. Sin `reset`, `clean`, `stash`,
`amend` ni `git add .`.
