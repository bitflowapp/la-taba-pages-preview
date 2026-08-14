# Growth engine · merchandising y personalización del storefront

Rama: `feature/taba2-commerce-growth-engine` (base `bc9af92`, la RC comercial congelada).
Código: `js/growth/`. Tests: `tests/growth-*.test.mjs` + `tests/e2e/growth-personalization.spec.mjs`.

## Qué es

Una capa que decide **qué pieza comercial va en cada superficie** del storefront
según la intención de la persona, el contexto y la frecuencia de exposición.
No es una plataforma de ofertas: **elige entre piezas ya válidas; jamás decide
qué se vende ni a qué precio**. Si el motor entero muere, cada superficie pinta
exactamente lo que pintaba antes (el fallback ES la tienda auditada de hoy).

## Arquitectura

```
señales (bridge) ──► intención (2 stores con decay) ──┐
                                                      ▼
campañas (data) ──► elegibilidad (fail-closed) ──► ranking ──► placements ──► ui.js
                         ▲                            ▲
              catálogo vivo / promos              exposición (frequency cap)
```

| Módulo | Rol | Depende de |
| --- | --- | --- |
| `growth-config.js` | TODOS los números ajustables | — |
| `intent-model.js` | perfil compacto con decay, puro | config |
| `context.js` | cubos horarios gruesos + rotación determinista | — |
| `complements.js` | grafo categoría→complementos (sin alcohol) | — |
| `campaign-eligibility.js` | normaliza campañas y filtra QUÉ PUEDE mostrarse | `core/promotions.js` |
| `ranking.js` | score explicable + diversidad multi-slot | los de arriba |
| `exposure-store.js` | impresiones/clicks/descartes por campaña | config |
| `analytics.js` | cola first-party acotada + interfaz de transporte | `core/storage.js` |
| `engine.js` | fachada: persistencia, memo por época, fail-safe total | todos |
| `campaigns-data.js` | catálogo de campañas (contenido de negocio) | — |
| `placements.js` | vista de catálogo + reglas por superficie + HTML | engine, core |
| `signal-bridge.js` | observa estado y DOM; no interviene en nada | engine, placements |
| `demo-personas.js` | harness A/B/C/E, sólo con `?growthDebug=1` | engine |

`ui.js` pregunta (`growthHeroSelection()`, `growthDoorSelection()`,
`growthCatalogInlineSelection()`, `growthHomeSectionOrder()`) y pinta; si la
respuesta es `null`/`[]`, corre su camino previo intacto. `app.js` sólo llama
`initGrowthBridge()` + `initGrowthDemoHarness()` en el bootstrap.

## Señales y pesos

Capturadas por el bridge sin tocar handlers existentes (diffs de estado +
listeners pasivos propios):

| Señal | Peso | Origen |
| --- | --- | --- |
| `category_view` | +2 | diff de `state.activeCategory` (categorías reales) |
| `search_match` | +4 ×(1/0.6/0.4) | query asentada 600 ms, contrastada contra el catálogo (máx. 3 categorías + marca) |
| `product_view` | +5 | click en `[data-product-detail]` |
| `add_to_cart` | +10 | diff de `state.cart` / `state.comboSelections` |
| `remove_from_cart` | −6 | ídem |
| `purchase` | +15 | diff de `state.lastOrderId` |
| `promo_click` | +6 | click en `[data-growth-campaign]` |
| `promo_dismiss` | −8 | descarte de pieza (si la superficie lo ofrece) |

Cada señal bumpea hasta tres claves: categoría, marca y producto. La query de
búsqueda **no se guarda**: sólo las categorías/marca que matcheó.

## Intención: decay y sesión

Dos stores del mismo modelo (`{ s: score, t: lastTs }` por clave):

- **Largo plazo** (`localStorage`, semivida **14 días**): lo que suele comprar.
- **Sesión** (`sessionStorage`, semivida **30 min**, **peso ×2**): lo que busca ahora.

Lectura: `score · 0.5^(Δt/semivida)`. Escritura: decaer y sumar, con tope 60
por clave (taps accidentales no dominan). Afinidad final = largo + sesión×2,
normalizada con saturación suave `s/(s+8)` → 0..1. Poda al persistir: top-N
claves por mapa (24/32/48) y epsilon 0.05. **Cold start** = perfil vacío →
manda la prioridad comercial (la vidriera actual).

## Campañas

`campaigns-data.js` — separación estricta definición / elegibilidad / ranking /
render (§39). Esquema por campaña:

```
id · enabled · kind (editorial|combo|promotion) · startsAt/endsAt (null = evergreen)
placements (hero|door|catalog-inline) · categoryIds · brand · comboId · promoId
priority (0-100) · contexts (morning/afternoon/evening/night/friday/weekend)
requiresIntent ('category' = sólo con afinidad real) · creative { eyebrow,
title, subtitle, image, focus, ctaLabel } · cta (category|brand|combo)
```

Reglas de honestidad (con test `growth-campaigns-data`):

- **editorial**: puerta con ganas; copy sin `%`, "oferta", "descuento", "gratis", precio.
- **combo**: el único dinero que muestra es el **derivado del catálogo vivo**
  (`core/combos.js`); si el combo deja de ser cobrable, la pieza no existe.
- **promotion**: sólo si `core/promotions.js` la valida ACTIVA (aprobación
  humana + precios verificables + vigencia). Hoy no hay ninguna activa: el día
  que exista, este tipo ya está cableado y rankea con boost propio.
- CTA con verbo real (`Ver / Pedir / Agregar / Sumar`); "Reservar" está
  prohibido por test.
- Imágenes: SOLO el lote curado (`docs/catalog/promo-image-manifest.json`);
  las derivadas livianas (`*-band.webp` 33-42 KB, `*-door.webp` 42-86 KB) se
  generan con `scripts/build-growth-creatives.mjs` y heredan la procedencia.

## Elegibilidad (antes que cualquier ranking)

Fail-closed en cadena: deshabilitada → afuera; fuera de vigencia → afuera
(aunque su score histórico fuera enorme); **destino sin producto comprable
AHORA → afuera** (mismo criterio P1-2 del hero/banners: categoría con
comprable, marca con destino real, combo cobrable); `promotion` sin promo
activa validada → afuera. La vista de catálogo (`buildGrowthCatalogView`) se
deriva del estado vivo con los predicados de `beverage-home-sections` y
`core/combos`, memoizada por referencia del array de productos.

## Ranking

```
score = intención·45 + prioridad·25 + complemento·20 + promoción·18 + contexto·6
      − penalización de frecuencia − repetición de categoría (30, desde el 2º slot)
```

- **Complemento**: campaña cuyo destino completa el carrito (fernet →
  gaseosas/hielo; destilados → mixers/hielo/energizantes; nunca alcohol).
- **Contexto**: proporción de los cubos declarados que están activos; suave a
  propósito (acompaña, no decide).
- **Diversidad**: selección greedy multi-slot; repetir rubro cuesta 30 puntos —
  mirar una cerveza no convierte la home en veinte cervezas.
- **Determinismo**: reloj inyectable, sin `Math.random`; empates exactos de
  cold start rotan por día calendario (`rotationIndex`).
- **Explicabilidad**: cada selección lleva `explain` por factor;
  `TABA2_GROWTH.explain('hero')` lo imprime en desarrollo. Nunca visible al cliente.

## Frequency cap

Por campaña: 2 impresiones gratis; después −4 puntos por impresión no
correspondida (tope 25); **8 impresiones sin click → excluida 24 h**; descarte
explícito → silencio 72 h; cada click perdona 4 impresiones. Impresiones
HONESTAS: IntersectionObserver al 50% visible, deduplicadas por época de vista.

## Estabilidad de render (anti-salto)

Las selecciones se memoizan por **época de vista**: entrar a una vista o
cambiar de categoría abre época nueva; dentro de una época, ni las señales en
vivo ni los re-renders del carrito mueven piezas bajo el dedo. La intención
acumulada manda en la PRÓXIMA entrada. El orden de secciones de la home usa el
mismo memo. CLS: todas las piezas reservan altura por CSS (`min-height`) y
existen desde el primer `innerHTML`.

## Superficies integradas

| Superficie | Dónde | Regla |
| --- | --- | --- |
| Hero contextual | home, slot existente | 1 pieza; la por defecto conserva banda CSS + preload del shell |
| Puertas rankeadas | banners intercalados entre carruseles | hasta 3; nunca un rubro con carrusel propio en pantalla |
| Orden de secciones | carruseles de la home | sólo con afinidad ≥ umbral; suben ANTES del corte de 6 |
| Pieza en grilla | catálogo, tras la 4ª tarjeta | 1 sola; nunca en búsqueda, ni grilla corta, ni el mismo rubro salvo combo |
| Cross-sell carrito | existente (`core/cart-recommendations`) | sin cambios: sus reglas ya están auditadas (P1-3) |
| Recompra | existente (reorder card) | sin cambios |

## Privacidad por diseño

- Se persisten **agregados** (`cervezas: 12` + timestamp), nunca eventos crudos
  ni PII. Claves propias versionadas (`la_taba_growth_*_v1`, variante showcase).
- Anónimo: todo local (localStorage/sessionStorage). Sin fingerprinting, sin
  identificación entre navegadores.
- Analytics: cola en `sessionStorage`, tope 200 eventos, campos de lista blanca
  (ids/placement/timestamps); `setGrowthAnalyticsTransport(fn)` es la interfaz
  para un backend futuro. `getGrowthFunnel()` arma impresión→click→agregado→
  checkout→compra por campaña (alcance: sesión).
- Estado corrupto → se descarta el registro y el motor arranca frío; la tienda
  ni se entera (test + e2e).

## Alcohol / +18

El motor no amplía la exposición de alcohol: sólo muestra destinos que la
góndola ya muestra, con los mismos componentes de tarjeta (+18 visible) y el
mismo checkout (confirmación + validación del servidor). Los complementos
jamás sugieren alcohol, una canasta de energizantes no recibe piezas
alcohol-forward por afinidad (el combo nocturno rankea sólo por cervezas), y
no existe ninguna señal de edad ni perfil que permita segmentar menores.

## Usuario autenticado (fase 2, NO construida)

Hoy: todo anónimo-local, suficiente para el piloto. Para cross-device haría
falta una tabla (p. ej. `customer_preferences(customer_id, bucket, key, score,
updated_at)` con RLS por dueño) que sincronice los MISMOS agregados compactos.
Diseño pendiente de fase explícita; **no se aplicó ninguna migración**.

## Panel de Walter (contrato futuro)

El esquema de campaña de `campaigns-data.js` ES el contrato: el panel deberá
poder crear/activar campañas con id, vigencia, placements, destino
(categoría/marca/combo/promoId), prioridad, contextos y creatividad curada.
Mientras el origen sea este archivo, activar una campaña es un cambio de
código; cuando exista origen remoto, `normalizeCampaignCollection` ya sanea
cualquier payload.

## Demo / debug

`?growthDebug=1` (nunca en uso normal) expone `TABA2_GROWTH`:
`persona('A'|'B'|'C'|'E')`, `explain(placement)`, `affinity()`, `funnel()`,
`events()`, `reset()`. Capturas reproducibles:
`node scripts/realtime-relay.mjs 8231 &` + `node scripts/taba2-growth-screenshots.mjs`
→ `artifacts/growth-engine/`.

## Ajustar sin miedo

Todos los números viven en `growth-config.js`. Los tests fijan COMPORTAMIENTO
(quién gana en cada escenario), no números mágicos: subir un peso que invierte
un escenario de la matriz rompe el test que lo protege, y eso es exactamente
lo que tiene que pasar.
