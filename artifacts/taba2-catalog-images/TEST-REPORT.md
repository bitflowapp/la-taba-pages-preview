# Qué se corrió, y qué se demostró que falla

Medido el 2026-08-18 sobre `feature/taba2-catalog-image-pipeline`, base `190b344`.
Todo en serie, con `TMP` en `D:` — el temporal global vive en un disco lleno y
con la suite en paralelo aparecen rojos que no son del código.

## Compuertas del repositorio

| | resultado |
|---|---|
| `npm run check` | **7/7 verde** |
| `npm test` | **1884 / 1884** |
| `npx playwright test` | **462 / 462** en 22,6 min — 360 chromium, 102 mobile-webkit |
| `npm run pwa:verify` | **verde**, con navegador real |
| `catalog:images:verify` | 8 imágenes con fuente, derechos y SHA-256 |
| `catalog:images:package-scan` | **PAQUETE LIMPIO** |

Las unitarias venían de 1861 en la autoridad; las 23 nuevas son
`tests/catalog-image-discovery.test.mjs`.

El E2E salió **entero verde**. En la autoridad quedaba 1 rojo conocido
(`panel-responsive`, falso, por correr cosas en paralelo). Acá no apareció.

## Los controles negativos

Lo que importa no es que las cuatro fotos correctas pasen: es que las
incorrectas no puedan. Cada línea de acá abajo es una forma concreta de publicar
la foto equivocada, y cada una está demostrada fallando.

### En las pruebas

| se intenta | qué pasa |
|---|---|
| una foto de pack para la unidad suelta | RECHAZO · «cantidad distinta: el SKU es x1 y la fuente publica x6» |
| otra capacidad con todo lo demás igual | RECHAZO · «capacidad distinta» |
| Zero donde el SKU es Original | RECHAZO |
| la lata donde el SKU es botella | RECHAZO · «envase distinto» |
| un combo de dos productos | RECHAZO · no describe un SKU solo |
| otra línea de la misma marca y cepa | MEDIA · «la línea no es idéntica», no se asocia sola |
| un sabor que ninguna lista enumera (Sour por Mountain Blast) | no llega a ALTA |
| un CDN de retailer en una fila aprobada | ERROR · «jumboargentina.vtexassets.com no está en la allowlist» |
| una fila APROBADA que declara `PENDIENTE_DERECHOS` | ERROR · «rights_status no acredita uso comercial» |
| un `source_url` que no parsea | `hostOf` devuelve null y no pasa por permitido |
| que un activo histórico de retailer se vuelva publicable | 120 archivos comprobados, ninguno publicable |
| que la allowlist permita y rechace el mismo host | comprobado, no se contradice |
| que un alcohólico quede disponible | 23 comprobados, ninguno `available` |
| un parecido entre imágenes sin explicación escrita | la hoja de contactos sale 1 |

### En vivo, sobre el paquete real

Se copió una foto de retailer a `assets/products/` y se rearmó todo:

1. `build-public-asset-manifest --check` → **sale 1**: «PUBLIC-PRODUCT-ASSETS.json
   está desactualizado».
2. `create-release-folder` → **no la copia**: pasa de 164 a 165 excluidas y
   publica las mismas 9.
3. Metida a mano dentro de `dist_release/` → `package-scan` **sale 1**:
   «INTRUSA … declarada sin derechos para publicar (sin declarar)» ·
   **PAQUETE SUCIO**.
4. Sacada la intrusa → **PAQUETE LIMPIO**, `package-scan` sale 0.

El paso 3 es el que importa: es el defecto que ya había pasado antes —un archivo
que nadie enlaza pero que igual queda servido con URL propia— y ahora se audita
lo que realmente está adentro del paquete, no lo que los productos apuntan.

## Cuatro pruebas que cambiaron de forma

Cuatro afirmaban «todavía no hay ninguna imagen comercial» como si fuera una
regla del sistema. Era el estado del repositorio el día que se escribieron: la
primera imagen las ponía rojas sin que nada se hubiera roto. Tres de ellas lo
decían en su propio mensaje de error («si esta lista crece…»).

| prueba | antes | ahora |
|---|---|---|
| `caso 10` en `product-sin-imagen` | la única publicable es el placeholder | toda publicable está declarada en el manifiesto y cita su autoridad |
| `la autorización no reetiqueta…` en `gondola-neuquen` | `assets_cubiertos` vacío | cada SKU cubierto tiene asset, con el estado que la autoridad habilita y viniendo de marca/embotellador |
| `commercial image audit…` en `image-sources` | `sources.length === 0` | cada entrada es rastreable: fuente HTTPS, SHA-256, derechos, fecha |
| `image verification…` en `catalog-image-pipeline` | falla porque el manifiesto está vacío | verifica el manifiesto real, y el fail-closed se comprueba con un manifiesto vacío sintético |

Se agregó además `caso 10 bis`: ninguna de las 120 rutas del manifiesto histórico
—las de retailer— puede volverse publicable. Eso es la garantía que la prueba
original protegía de verdad, y ahora está dicha directamente en vez de deducirse
de un conteo.

## Lo que NO se probó

- **Ninguna prueba física.** No hay dispositivo en esta corrida.
- **Ninguna medición de red real.** Los números de `PERFORMANCE.md` son de
  archivo y de contrato, no de campo.
- **Nada contra producción salvo lecturas.** La fotografía del catálogo se sacó
  con la clave publicable, que no escribe. El lote de asociación quedó emitido y
  sin aplicar.
- **La vitrina con estas fotos puestas.** Asociarlas exige escribir en
  `products` con un owner autenticado. Hasta que eso pase, el cliente sigue
  viendo el placeholder en los 56, y eso es lo que las pruebas verifican hoy.
