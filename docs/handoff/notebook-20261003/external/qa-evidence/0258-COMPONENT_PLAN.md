# TABA — Plan de componentes

De **5 tarjetas + 3 steppers + 2 favoritos + 4 medias** a un juego consolidado.

## Consolidación

| Hoy | Mañana | Acción |
|---|---|---|
| `.product-card`, `.home-catalog-card`, `.offer-card`, `.recommendation-card`, rail de `.home-best-sellers` | **`.product-card`** con densidades `--grid` y `--rail` | Reescribir la plantilla en `js/ui.js`; borrar 4 bloques CSS |
| `.product-media`, `.home-catalog-media`, `.offer-card-media`, `.recommendation-media` | **`.product-media`** con `aspect-ratio: 1/1` | Un bloque; el resto se borra |
| `.qty-stepper`, `.quantity-control`, `.modal-quantity-field` | **`.qty-stepper`** con controles de 44px | Unificar markup y estilos |
| `.product-favorite`, `.home-favorite-button` | **`.product-favorite`** 44×44 anclado al media | Unificar |
| Tarjetas de métrica del negocio + tabs de estado | **`.b-band`** (52px, resume y filtra) | Nuevo; elimina dos bloques |
| Tabs de sección del negocio | **`.mobile-nav`** del negocio (4 destinos) | Reutiliza el componente de nav del cliente |
| Filas de configuración dispersas | **`.t-row`** dentro de `.t-group` | Nuevo, transversal |

## Componentes nuevos

| Componente | Dónde | Reemplaza |
|---|---|---|
| `.b-band` | Negocio móvil | 4 tarjetas de métrica (~260px) + fila de tabs (~60px) |
| `.o-card` | Negocio móvil y escritorio | Fila de la cola actual |
| `.t-row` / `.t-group` | Negocio, perfil, rider | Listas de configuración ad hoc |
| `.t-sticky-cta` | Cliente móvil | `.floating-cart` reescrito |
| `.b-actionbar` | Negocio móvil | No existe hoy |
| `.d-shell` | Negocio escritorio | Layout actual |
| `.k-drawer` | Catálogo escritorio | No existe hoy |
| `.t-empty` | Todas | Estados vacíos dispersos |
| `.t-skel` | Catálogo | No existe hoy |

## Componentes que se eliminan

| Componente | Motivo |
|---|---|
| `.product-media-control` | Posicionamiento absoluto con offset mágico — causa de P0-02 |
| Rail `.home-best-sellers.offers-rail` con markup propio | Duplicado y colapsado — causa de P1-05 |
| `.home-preview-label` | Etiqueta técnica en la superficie del cliente |
| Tabs de sección del negocio | Sustituidas por bottom nav |
| Segunda fila de tabs de estado | Fusionada en `.b-band` |
| Tarjetas de categoría de 105px | Sustituidas por chips |
| Tarjeta de dirección de 92px | Integrada al header |

## Contratos de componente

### `.product-card`

```
Props (vía data-attributes en el markup generado):
  id, brand, name, presentation, price, available, purchasable, imageUrl, qty, favorite
Estados: normal · con cantidad · sin precio · sin stock · cargando
Invariantes:
  - El media tiene aspect-ratio, nunca altura fija
  - Ninguna acción está posicionada en absoluto (excepto el favorito, anclado al media)
  - Si purchasable = false, no existe la acción de agregar
```

### `.b-band`

```
Props: counts { new, prep, ready, way }, active, hasAlert
Emite: change(filter)
Invariantes:
  - Es simultáneamente resumen y filtro: no hay dos controles para lo mismo
  - Altura fija de 52px
  - aria-pressed por segmento
```

### `.t-sticky-cta`

```
Props: count, total, label
Invariantes:
  - No se renderiza con count = 0
  - Su altura sale de --cta-h
  - Su bottom se deriva de --nav-block, nunca literal
```

## Orden de construcción

1. **Primitivas** — botón, chip, campo, pill, fila, grupo, estado vacío, esqueleto. Sin dependencias.
2. **`.product-card` + `.qty-stepper` + `.product-favorite`** — dependen de las primitivas.
3. **`.t-sticky-cta` + nav** — dependen de los tokens de la etapa 1.
4. **`.o-card` + `.b-band` + `.b-actionbar`** — negocio móvil.
5. **`.d-shell`** — negocio escritorio; depende de `.o-card`.
6. **`.k-drawer`** — catálogo escritorio; depende de `.product-card`.

## Criterio de “terminado” por componente

- Existe en los cinco prototipos con el mismo markup.
- Pasa el chequeo de objetivos táctiles.
- Tiene sus estados documentados y capturados.
- No introduce ningún `z-index` ni medida de chrome literal.
- Sus `@media` están después de su definición base.
