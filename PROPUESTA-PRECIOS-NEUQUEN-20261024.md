# PROPUESTA DE PRECIOS · góndola Neuquén · 2026-10-24

> **ESTADO GENERAL: `pendiente_aprobacion_comercial`.**
> Este documento NO modifica el catálogo. Cargan/confirmar un precio en la góndola ES
> confirmarlo (CONTRATO-PRECIO-STOCK.md): nada de acá entra al catálogo sin aprobación
> explícita del comercio, y la única vía de carga segura es
> `apply_commercial_catalog_batch` (nunca escrituras directas ni ediciones a mano).

---

## 1 · Resumen ejecutivo

Comparación contra Neuquén Capital sobre **52 SKUs** de la autoridad
`catalog/gondola-neuquen.mjs` con precios verificados **hoy 2026-10-24** en La Anónima
Neuquén y DIA Online. El objetivo comercial era quedar **7 % (banda 5–10 %) por debajo
del precio regular más barato verificado**, sin romper nunca el piso de margen.

| Estado de la propuesta | SKUs | Qué significa |
|---|---:|---|
| `mantiene_vigente` | **32** | Ya están ≥ 5 % por debajo del más barato verificado: no hay nada que cambiar. |
| `conflicto_margen` | **14** | Subir la rebaja a la banda rompería el piso de margen; el vigente se mantiene y hace falta decisión de negocio. |
| `pendiente_sin_comparador` | **5** | Sin equivalente regular verificado hoy; sin comparador no hay número. |
| `pendiente_coincidencia_parcial` | **1** | Sólo familia (sin equivalencia exacta): no alimenta el comparador. |
| **Rebajas propuestas** | **0** | La góndola ya está bajo el mercado en todo lo comparable salvo los conflictos. |

En los 46 SKUs con comparador exacto, el precio que propone esta rama **es el vigente en
los 46** (32 porque ya cumplen la banda, 14 porque la banda es inalcanzable sin romper el
piso). El 0 % de rebajas no es un hallazgo menor: es el resultado de que el criterio
publicado (costo × 1,45) dejó los precios ya competitivos salvo los 14 conflictos, y ahí
el conflicto es de **costo**, no de precio de venta.

---

## 2 · Metodología

### 2.1 Piso de margen (nunca se rompe)

El piso es el criterio publicado en la propia autoridad (`precioDeVenta` de
`catalog/gondola-neuquen.mjs`):

- Unidad: `costoMayorista × 1,45`, redondeo al múltiplo de $50 hacia arriba.
- Pack: `costoMayorista × 1,35 × unitsPerPack`, mismo redondeo.

Verificación mecánica del 2026-10-24: **los 52 precios vigentes son exactamente el
`precioDeVenta(...)` de su costo mayorista** (cero desvíos). Es decir: hoy, *vigente ==
piso* en toda la góndola. Toda bajada rompería el criterio; por eso el motor propone
`mantiene_vigente` o `conflicto_margen`, y **cero** `propuesto`.

Precio objetivo dentro de la banda: `más barato verificado × (1 − 7 %)`, con tope
inferior de banda en −10 % y tope superior en −5 %; siempre que el objetivo no baje del
piso (`precioDeVenta`). Si el precio de banda más fácil (−5 %) ya está por debajo del
piso, el SKU es `conflicto_margen`.

### 2.2 Qué precios alimentan el comparador

- **Sólo precios regulares** de góndola minorista, unitarios y de presentación
  equivalente (misma marca, variedad, envase y capacidad).
- **Promos y precios tachados quedan fuera**: un 2×1 no es un precio regular.
- **La Anónima (ANCA)**, relevado en HTML crudo de 11 categorías (2026-10-24):
  `precioRegular = data-precio_anterior` (el tachado cuando hay promo) o `data-precio`
  cuando no hay promo. El `offers.price` de JSON-LD es precio de promo y no entra. Los
  rótulos «Llevando N, pagás c/u» **condicionan sólo el precio de promo**; el regular
  tachado es el precio unitario de góndola y SÍ compara. Verificado en los SKUs
  ANCA 1019855 / 0492681 (lata 354 Coca-Cola): precio por lt impreso $5.226 ⇒
  1.850 × 6 ⇒ los nombres «Multipack x6» son precio unitario minorista.
- **DIA Online**: API VTEX por consulta (33 consultas guardadas). Comparador =
  **precio de venta efectivo del día** (criterio conservador), con `precioLista`
  registrado aparte en la evidencia. Ejemplo: Red Bull sin azúcar vigente DIA
  $2.860,8 efectivo (lista $3.576).
- **PedidosYa: NO verificable hoy** (403 a agentes automatizados). Los antecedentes de
  la investigación del **2026-10-10** (rama `feature/catalog-prices-pedidosya-20261010`,
  commits `24f46326` y `86be1dbe`) quedan etiquetados como **históricos**: no se usan
  como comparador vigente en este documento.
- **Coincidencias PARCIAL** (mismo tipo de product o familia, sin equivalencia
  acreditada) **no alimentan el comparador**: quedan como referencia de contexto y el
  SKU pasa a `pendiente_*`.

### 2.3 Estados del motor

| Estado | Regla |
|---|---|
| `mantiene_vigente` | Vigente ya está ≥ 5 % bajo el más barato exacto. No se propone cambio (el 7 % es objetivo, la banda es el rango admisible). |
| `conflicto_margen` | Piso > tope superior de banda: cumplir la banda implica vender bajo el piso. Vigente no se toca; decisión de negocio. |
| `pendiente_sin_comparador` | No se verificó ningún producto equivalente hoy. Sin comparador no se propone precio. |
| `pendiente_coincidencia_parcial` | Hubo listado de la familia pero sin equivalencia exacta; no alimenta comparador. |
| `propuesto` / `propuesto_en_piso_margen` | Rebaja efectiva dentro de la banda (o precisamente en el piso). **Hoy: ningún caso.** |

Motor y reglas de emparejamiento: `artifacts/catalog-pricing-images-20261024/tools/empatar-precios.mjs`
(reglas revisadas fila por fila contra listados reales; `coincidencias.csv` registra por
cada precio: tienda, fecha, nombre del listado competidor, URL/código y si es EXACTA o
PARCIAL). Lectura humana: `node revisar-vista.mjs [todo|coincidencias|propuesta]`.

---

## 3 · Comparación por SKU (52)

### 3.1 `conflicto_margen` (14) — la decisión pende de negocio

En las 14 filas, **el piso de margen supera el tope de banda (−5 %)**: competir a la
banda significaría vender por debajo del costo × 1,45. En los 6 marcados con `+` el
vigente está encima del más barato: DIA está descontando fuerte gins/vodkas/colas.

| SKU | Vigente | Piso margen | Más barato | Tienda | Vigente vs. más barato | Coincidencia |
|---|---:|---:|---:|---|---:|---|
| coca-cola-original-2250ml | $5.900 | $5.900 | $6.000 | DIA Online | **−1.7%** | EXACTA |
| coca-cola-zero-2250ml | $5.900 | $5.900 | $6.000 | DIA Online | **−1.7%** | EXACTA |
| coca-cola-zero-lata-354ml | $1.800 | $1.800 | $1.850 | La Anónima | **−2.7%** | EXACTA |
| sprite-original-2250ml | $5.900 | $5.900 | $6.000 | DIA Online | **−1.7%** | EXACTA |
| sprite-zero-2250ml | $5.900 | $5.900 | $6.000 | DIA Online | **−1.7%** | EXACTA |
| sprite-original-lata-354ml | $1.800 | $1.800 | $1.850 | La Anónima | **−2.7%** | EXACTA |
| fanta-naranja-2250ml | $5.900 | $5.900 | $6.000 | DIA Online | **−1.7%** | EXACTA |
| pepsi-original-2000ml | $3.800 | $3.800 | $3.520 | DIA Online | **+8%** | EXACTA |
| paso-de-los-toros-pomelo-1500ml | $3.250 | $3.250 | $3.160 | DIA Online | **+2.8%** | EXACTA |
| red-bull-sin-azucar-250ml | $2.800 | $2.800 | $2.860,8 | DIA Online | **−2.1%** | EXACTA |
| quilmes-clasica-botella-710ml | $3.000 | $3.000 | $2.990 | DIA Online | **+0.3%** | EXACTA |
| stella-artois-lata-473ml | $3.600 | $3.600 | $3.400 | DIA Online | **+5.9%** | EXACTA |
| gin-gordons-700ml | $16.800 | $16.800 | $14.625 | DIA Online | **+14.9%** | EXACTA |
| vodka-skyy-700ml | $9.500 | $9.500 | $8.590 | DIA Online | **+10.6%** | EXACTA |

Lectura: los coeficientes del margen (1,45) son razonables frente a minorista pleno, pero
DIA está vendiendo **por debajo del costo mayorista de TABA** en gins, vodkas y colas —
es una guerra de precios de su cadena central, no un error de nuestra góndola. Las
alternativas de decisión (acá no se eligen: se elevan al dueño):
1. Mantener precio vigente y no competir dollar-a-dólar con una promo estructural (recomendado: protege margen).
2. Renegociar el costo mayorista (Maxiconsumo) para algunos SKUs — entonces el piso baja y la banda vuelve a ser alcanzable.
3. Excepción de margen explícita y acotada por SKU (riesgo de capital, decide el dueño).

### 3.2 `mantiene_vigente` (32) — ya cumplen la banda

Preferencia del rango −5..−10 % vs. el más barato verificado; no hay cambio que proponer (el
7 % objetivo se cita como referencia, no como exigencia).

| SKU | Vigente | Más barato | Tienda | Vigente vs. más barato | Coincidencia |
|---|---:|---:|---|---:|---|
| coca-cola-original-lata-354ml | $1.800 | $2.700 | DIA Online | −33.3% | EXACTA |
| pepsi-black-1500ml | $2.650 | $3.160 | DIA Online | −16.1% | EXACTA |
| seven-up-original-2000ml | $3.800 | $4.650 | La Anónima | −18.3% | EXACTA |
| paso-de-los-toros-tonica-1500ml | $3.250 | $4.100 | La Anónima | −20.7% | EXACTA |
| villa-del-sur-sin-gas-600ml | $1.700 | $2.250 | La Anónima | −24.4% | EXACTA |
| villavicencio-sin-gas-1500ml | $2.400 | $3.300 | La Anónima | −27.3% | EXACTA |
| villavicencio-con-gas-500ml | $1.900 | $2.000 | DIA Online | −5% | EXACTA |
| benedictino-sin-gas-2250ml | $2.250 | $2.700 | DIA Online | −16.7% | EXACTA |
| aquarius-pera-1500ml | $1.800 | $3.100 | DIA Online | −41.9% | EXACTA |
| aquarius-manzana-1500ml | $1.800 | $3.100 | DIA Online | −41.9% | EXACTA |
| aquarius-pomelo-2250ml | $2.650 | $3.850 | DIA Online | −31.2% | EXACTA |
| red-bull-original-250ml | $2.800 | $3.439 | DIA Online | −18.6% | EXACTA |
| monster-green-zero-473ml | $3.250 | $3.500 | DIA Online | −7.1% | EXACTA |
| speed-original-473ml | $2.850 | $3.045 | DIA Online | −6.4% | EXACTA |
| speed-zero-473ml | $2.850 | $3.045 | DIA Online | −6.4% | EXACTA |
| gatorade-cool-blue-500ml | $2.000 | $3.250 | La Anónima | −38.5% | EXACTA |
| gatorade-manzana-1250ml | $2.650 | $2.850 | DIA Online | −7% | EXACTA |
| powerade-mountain-blast-500ml | $1.450 | $2.200 | DIA Online | −34.1% | EXACTA |
| brahma-chopp-lata-710ml | $3.000 | $4.200 | La Anónima | −28.6% | EXACTA |
| budweiser-lata-473ml | $2.350 | $2.950 | La Anónima | −20.3% | EXACTA |
| corona-extra-botella-330ml | $3.400 | $4.700 | DIA Online | −27.7% | EXACTA |
| andes-origen-rubia-lata-473ml | $2.650 | $3.550 | La Anónima | −25.4% | EXACTA |
| andes-origen-roja-lata-473ml | $2.650 | $3.800 | La Anónima | −30.3% | EXACTA |
| patagonia-amber-lager-botella-730ml | $5.300 | $7.550 | La Anónima | −29.8% | EXACTA |
| fernet-1882-750ml | $8.950 | $12.000 | DIA Online | −25.4% | EXACTA |
| gancia-americano-450ml | $4.350 | $6.130 | DIA Online | −29% | EXACTA |
| gancia-lima-limon-lata-473ml | $2.550 | $3.700 | La Anónima | −31.1% | EXACTA |
| dr-lemon-vodka-pomelo-lata-473ml | $2.200 | $2.850 | DIA Online | −22.8% | EXACTA |
| trapiche-origen-malbec-750ml | $6.150 | $8.581 | DIA Online | −28.3% | EXACTA |
| dada-caramel-750ml | $5.900 | $7.550 | La Anónima | −21.9% | EXACTA |
| cafayate-torrontes-750ml | $5.400 | $5.890 | DIA Online | −8.3% | EXACTA |
| toro-tinto-1000ml | $2.300 | $2.990 | DIA Online | −23.1% | EXACTA |

### 3.3 `pendiente_*` (6) — falta comparador, falta decisión de negocio

| SKU | Vigente | Piso | Estado | Comparador hoy |
|---|---:|---:|---|---|
| soda-manaos-sifon-2000ml | $1.750 | $1.750 | pendiente_sin_comparador | — |
| quilmes-clasica-lata-473ml | $2.050 | $2.050 | pendiente_sin_comparador | — |
| quilmes-clasica-lata-473ml-pack-6 | $11.400 | $11.400 | pendiente_sin_comparador | — |
| quilmes-stout-lata-473ml | $2.050 | $2.050 | pendiente_sin_comparador | — |
| fernet-branca-1000ml | $26.250 | $26.250 | pendiente_sin_comparador | — |
| toro-viejo-clasico-tinto-750ml | $2.550 | $2.550 | pendiente_coincidencia_parcial | $3.000 (La Anónima, referencia PARCIAL) |

Motivos registrados en la propuesta (JSON/CSV), síntesis:

- **soda-manaos-sifon-2000ml**: sin listado de sifón Manaos en aguas/gaseosas de ninguna
  de las dos tiendas hoy.
- **quilmes-clasica-lata-473ml**: la Clásica 473 unidad no está listada (ANCA sólo trae
  IPA $2.850 y Bajo Cero $2.050 en 473; DIA sólo Bajo Cero, 0.0, Cristal y 1890).
- **quilmes-clasica-lata-473ml-pack-6**: ningún competitivo lista el pack x6 de la
  Clásica (ANCA trae packs x6 de otras variedades a $17.000 y el x4 de Quilmes 710 a
  $15.900; no equivalentes).
- **quilmes-stout-lata-473ml**: la Stout 473 sólo en pack x6 (ANCA $17.000 ≈ $2.833/un),
  no hay unidad suelta ni en DIA.
- **fernet-branca-1000ml**: ninguna de las dos tiendas lista el Branca 1 L (el 750 está
  en DIA a $12.000 lista y ANCA a $19.700; no es la misma presentación).
- **toro-viejo-clasico-tinto-750ml**: sólo referencia de familia a $3.000 (La Anónima);
  exige equivalencia exacta antes de proponer.

Acción sugerida para estos 6: verificación **física** en sucursal Neuquén (góndola de
mayorista/bebidas) o Preise PedidosYa tomados manualmente desde la app (no automatizados)
para construir comparador; mientras tanto, vigente NO se toca.

---

## 4 · Auditoría de imágenes (autoridad visual)

- **Autoridad visual**: `docs/catalog/gondola-publica-imagenes.{csv,json}` — 33 SKUs,
  **todas fotos reales** (`tipo=REAL`), regeneradas hoy. Clasificación: **17
  AUTHORIZED_EXACT + 16 OFFICIAL_EXACT**. Derechos: licencia comercial
  **TABA-AUT-2026-08-001** para las 33. Ninguna foto del mapa proviene de minorista
  (`catalog/image-source-allowlist.json` excluye hosts de retailers salvo aprobación
  por-asset).
- **Gate de alcohol**: 23 de los 52 SKUs llevan alcohol (`is_alcoholic=true`) y siguen
  **ocultos en producción** hasta la habilitación de expendio (RLS). Las propuestas de
  esos 23 igualmente quedan registradas aquí.
- **QA de la ficha**: 33/33 imágenes de mapa cargan por el mismo host de assets de la
  tienda (preview local), todos los archivos existen en disco, y el precio mostrado por
  los 29 SKUs de góndola no alcohólicos coincide 29/29 con el vigente de la autoridad.
  Captura completa: `artifacts/catalog-pricing-images-20261024/qa/capturas/05-ficha-propuesta-completa.png`.
- **Hallazgo de alcance** (para el dueño, no es deficiencia de esta rama): el mapa
  auditado incluye **4 SKUs fuera de la góndola de 52** —
  `coca-cola-original-botella-pet-500-ml-pack-x12`,
  `coca-cola-zero-botella-pet-500-ml-pack-x12`,
  `sprite-botella-pet-500-ml-pack-x12` y `coca-cola-original-pet-1500ml`. Tienen foto
  auditada y licencia, pero **no forman parte de esta propuesta de precios**: son de la
  ola de expansión retail (`catalog/gondola-retail-final-proposal.mjs`). Verificada
  imagen + derechos; precio fuera de alcance.

---

## 5 · Cadena de evidencia

- **La Anónima (2026-10-24)**: `artifacts/catalog-pricing-images-20261024/fuentes/laanonima/`
  — HTML crudo + CSV por categoría (11 categorías: aguas con gas, aguas sin gas, aguas
  saborizadas y jugos, gaseosas regulares, gaseosas dietéticas, isótonicas y
  energizantes, cervezas, fernet y aperitivos, vinos tintos, vinos blancos, blancas y
  whiskies) + `nombres-unicos-utf8.txt`. Sucursal por defecto del sitio: Neuquén.
- **DIA Online (2026-10-24)**: `fuentes/dia/` — 33 consultas API VTEX (una por SKU de la
  propuesta) + `resultados.csv` (322 filas) + `listado.txt`.
- **PedidosYa**: no verificable hoy (403 a agentes); histórico 2026-10-10 en la rama
  `feature/catalog-prices-pedidosya-20261010`, etiquetado histórico.
- **Matcheo y propuesta**: `fuentes/...-20261024/coincidencias.csv` (85 filas: tienda,
  fecha, nombre competidor, precio regular, promo y lista DIA, tipo, URL/código),
  `propuesta-precios.csv` y `propuesta-precios.json` (estadoGeneral:
  `pendiente_aprobacion_comercial`).

Para replicar: `node artifacts/catalog-pricing-images-20261024/tools/empatar-precios.mjs`
(regenera `coincidencias.csv` + `propuesta-precios.*` desde las fuentes guardadas) y
`node tools/revisar-vista.mjs todo` para lectura humana.

---

## 6 · Verificaciones corridas en esta rama

| Verificación | Resultado |
|---|---|
| `npm run check` | PASS |
| `npm test` | **3193 pass / 0 fail** (~8 min) |
| `catalog:images:audit --check` | OK (todas las imágenes del mapa existen y están clasificadas) |
| `catalog:prices:check` | OK (9 bloqueos por unit-price son pre-existentes, sin tocar) |
| `catalog:readiness` | `catalog/readiness-report.csv` escrito (92 filas) |
| QA brutal de vitrina (preview local Chromium): 80 tarjetas, overflow 0 px en 390/1280, ficha abre con precio, 0 pageerrors | OK |
| QA de ficha de propuesta: 33/33 fotos reales cargan · 29/29 precios == vigente · 4 SKUs fuera de la góndola marcados | OK |
| Suite completa `qa:taba2:commercial-screenshots` (Chromium + WebKit, 6 anchos, checkout y retornos de MP) | **OK · 151 capturas / 0 incidencias** (`artifacts/taba2-commercial-audit/final/`) |
| `catalog:release:validate` | No corresponde acá: exige `TABA_CATALOG_FILE` (export de producción); es gate de release |

`qa:taba2:screenshots` quedó descartado por drift de fixture (busca
`red-bull-original-lata-250ml-pack-4`, SKU que ya no existe): es pre-existente y no
toca esta rama.

---

## 7 · Definiciones de decisión (para el comercio)

1. **Aprobar "sin cambios"** en los 46 con comparador — es lo que esta rama propone;
   no hay carga que hacer.
2. **Decidir los 14 `conflicto_margen`**: subir piso (renegociar costo), aceptar quedarse
   fuera de la banda (vigente como está), o excepción puntual de margen.
3. **Resolver los 6 pendientes**: verificación física/manual para construir comparador
   (ver §3.3); después de eso se puede proponer precio por SKU con la misma metodología.
4. **Publicación**: tras la aprobación, la carga a góndola se hace por
   `apply_commercial_catalog_batch` con auditoría; los 23 alcohólicos quedan condicionados
   a habilitación de expendio.

---

## 8 · Declaración de alcance (importante)

- **Nada fue aplicado al catálogo.** El archivo `catalog/gondola-neuquen.mjs`, el
  storefront y cualquier dato de producción no fueron modificados: la rama sólo agrega
  `artifacts/catalog-pricing-images-20261024/` (evidencia, motor, propuesta), regenera
  `docs/catalog/gondola-publica-imagenes.{csv,json}` (auditoría de imágenes) y
  `catalog/readiness-report.csv`.
- Esos artefactos viven en un worktree aislado
  (`C:\Users\marco\worktrees\la-taba-catalog-pricing-20261024`, rama
  `feature/catalog-pricing-images-20261024`) sobre
  `release/commercial-readiness-20261023`; **sin merge a producción ni pruebas contra
  producción**.
- El único estado válido de esta propuesta mientras no haya aprobación comercial es
  **`pendiente_aprobacion_comercial`**.
