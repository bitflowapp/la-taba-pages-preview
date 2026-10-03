# Regresión visual: encabezados del panel en los anchos del mostrador

Anchos verificados: **320, 360, 390, 412 y 432 px**.
Pantallas: **Abrir el negocio** y **Probar dispositivos**.
Selectores bajo prueba: `.device-row header` y `.opening-check header`.

Spec: `tests/e2e/business-panel-responsive.spec.mjs` — 5 pruebas, una por ancho, ambas pantallas
en cada una.

## Qué se mide, y cómo

No se compara contra una imagen de referencia. Se mide el texto renderizado:

- **Cortes arbitrarios:** para cada título se recorre su nodo de texto palabra por palabra con
  `Range.getClientRects()`. Si una sola palabra ocupa más de un rectángulo de línea, se partió
  al medio y la prueba falla nombrando la palabra.
- **Encabezado envuelto:** `getComputedStyle(header).flexWrap === 'wrap'`.
- **Etiqueta de estado legible:** texto no vacío, ancho mayor a cero y `scrollWidth` que no
  excede `clientWidth` (es decir, no quedó recortada).
- **Overflow horizontal:** `document.documentElement.scrollWidth <= window.innerWidth`.
- **Targets:** ningún botón visible y habilitado por debajo de 44 px de alto.
- **Botones de confirmación:** el texto exacto de `[data-device-confirm]`.

## Resultado sobre `8028dcc`

| Ancho | Cortes arbitrarios | Encabezado envuelve | Estado legible | Overflow | Targets < 44 px | Resultado |
|---|---|---|---|---|---|---|
| 320 px | 0 | sí | sí | no | 0 | PASS |
| 360 px | 0 | sí | sí | no | 0 | PASS |
| 390 px | 0 | sí | sí | no | 0 | PASS |
| 412 px | 0 | sí | sí | no | 0 | PASS |
| 432 px | 0 | sí | sí | no | 0 | PASS |

"Impresoras" y "Facturación" se leen enteras en los cinco anchos. Los botones dicen
exactamente `Salió el papel de la térmica` y `Salió el papel de la A4`.

## El guard sirve: se comprobó

Una prueba que sólo pasa no demuestra nada. Se revirtió el arreglo de CSS en local y se volvió
a correr el ancho más exigente:

```
✘ panel a 320 px: encabezados sin cortes arbitrarios, sin overflow y con targets usables
  Error: day-open a 320 px partió palabras al medio
  - Expected  - 1
  + Received  + 3
```

Tres palabras partidas, exactamente el defecto que la certificación anterior había visto en las
capturas. Con el arreglo restaurado, los cinco anchos pasan.

## Capturas

En `capturas-responsive/`: 10 imágenes, las dos pantallas por cada uno de los cinco anchos, con
datos QA. Fuera del repositorio, como corresponde.
