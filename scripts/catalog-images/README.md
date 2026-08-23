# Pipeline de imágenes del catálogo

Conseguir, verificar, procesar y asociar la fotografía comercial de cada
producto, sin publicar nunca una que no corresponda o que no se pueda publicar.

## El flujo

```
snapshot -> audit -> discover -> stage -> [MIRAR] -> approve
                  -> fetch -> normalize -> verify
                  -> manifest -> sheet -> package-scan -> sql
```

| paso | comando | qué hace |
|---|---|---|
| 1 | `npm run catalog:images:snapshot` | fotografía el catálogo productivo, sólo lectura |
| 1b | `npm run catalog:images:audit` | mapa SKU → imagen de la góndola comprable: REAL / FALLBACK / INCORRECTA / AUSENTE |
| 2 | `npm run catalog:images:discover` | cosecha las fuentes permitidas y puntúa cada candidato |
| 3 | `npm run catalog:images:stage` | baja los ALTA, calcula su SHA-256 y los anota EN REVISIÓN |
| 4 | — | **una persona abre las imágenes y las mira** |
| 5 | `npm run catalog:images:approve -- --revisado-por "…" --todas-las-revisables` | firma la revisión |
| 6 | `npm run catalog:images:fetch` | descarga verificando el SHA-256 aprobado y la allowlist |
| 7 | `npm run catalog:images:normalize` | master 1000×1000 y thumbnail 400×400 WebP, fondo blanco |
| 8 | `npm run catalog:images:verify` | comprueba archivos, hashes, binding y derechos |
| 9 | `npm run catalog:images:manifest` | escribe la lista de lo que el paquete puede copiar |
| 10 | `npm run catalog:images:sheet` | hoja de contactos y detección de repetidas |
| 11 | `npm run catalog:images:package-scan` | abre `dist_release/` y comprueba lo que quedó adentro |
| 12 | `npm run catalog:images:sql` | emite el lote de asociación; **no lo aplica** |

## Las cuatro reglas que no se negocian

**1. La cantidad del pack nunca se aproxima.** Un packshot de doce no ilustra una
unidad suelta. Es el único eje que rechaza siempre, sin degradar a revisión:
le miente al cliente sobre lo que va a recibir.

Y no es sólo el título: la tienda del embotellador estampa la cantidad ENCIMA de
la foto, con un sello «x6» o «x12». Para el pack que sí trae esa cantidad el
sello dice la verdad —los cuatro packs publicados vienen de ahí—; para una
unidad suelta, no. Medido el 2026-08-23 sobre los 15 candidatos oficiales que
corresponden a SKU visibles sin foto: los 15 traen sello y en los 15 el sello
pisa el envase, así que tampoco se puede borrar sin repintar producto. La
medición vive en `catalog/sello-de-pack-medicion.json`; se rehace con
`npm run catalog:images:sello` y la mide `medir-sello-de-pack.mjs`.

**2. La procedencia es parte de la identidad del activo.** Un host que no esté en
`catalog/image-source-allowlist.json` no se descarga, y la lista se vuelve a
mirar DESPUÉS de seguir los redirects. Un CDN de retailer no entra aunque el
título calce perfecto.

**3. Aprobar es mirar.** Ningún guion marca `APROBADA` por su cuenta. El
descubrimiento prepara y calcula; una persona abre la imagen, y su nombre queda
escrito en el CSV.

**4. Publicar es subir, no enlazar.** Un archivo que viaja en el paquete queda
servido con URL propia, lo referencie un producto o no. Por eso el empaquetado
copia por lista de publicables —en positivo— y `package-scan` audita lo que
realmente quedó adentro.

## Dónde vive cada cosa

| archivo | qué es |
|---|---|
| `catalog/image-source-allowlist.json` | qué dominios pueden aportar una foto, y con qué tipo de fuente entra cada marca |
| `catalog/autorizaciones-comerciales.json` | bajo qué autoridad se publica, y qué cubre |
| `catalog/duplicados-explicados.json` | parecidos entre imágenes ya mirados y justificados |
| `catalog/sello-de-pack-medicion.json` | el sello de cantidad de cada packshot oficial, medido |
| `docs/catalog/gondola-publica-imagenes.csv` | qué muestra hoy cada SKU comprable, y por qué |
| `catalog/PUBLIC-PRODUCT-ASSETS.json` | las únicas fotos de producto que el paquete puede copiar |
| `catalog/production-catalog-snapshot.json` | el catálogo productivo, congelado para poder reproducir una revisión |
| `docs/catalog/image-source-audit.csv` | la auditoría de fuentes, con su estado de revisión |
| `docs/catalog/image-manifest.json` | el manifiesto final: rutas, hashes, binding y derechos |

## Sumar una marca

Agregar un grupo a `catalog/image-source-allowlist.json` con su `storeHost`, sus
`cdnHosts`, sus categorías y el `sourceType` que le corresponde, y correr
`discover`. Si la tienda no es VTEX hace falta un adaptador nuevo en `sources/`:
tiene que devolver título, marca declarada e imagen, y nada más. Un adaptador que
además opina sobre si el candidato sirve es un adaptador que no se puede
reemplazar.

## Vocabularios controlados

- `source_type`: `fabricante`, `marca`, `distribuidor_oficial`,
  `proveedor_aprobado` o `propio`.
- `rights_status`: `PROPIO`, `LICENCIA_COMERCIAL` o `PERMISO_DOCUMENTADO`. Los
  tres mismos que exige `catalog_assets_rights_valid` en la base y que usa la
  vitrina: que rija una sola lista en los tres lugares es el punto entero.
- `status` de revisión: `APROBADA`, `REVISAR_DATOS`, `REVISAR_IMAGEN`,
  `SIN_IMAGEN` o `PENDIENTE_DERECHOS`.
- Fuentes raster admitidas: JPEG, PNG, WebP, AVIF o TIFF.

## Dónde van los archivos, y por qué ahí

`assets/products/`, plano, master y thumbnail juntos. No es una preferencia: es
lo único que `products_verified_publication_authority` acepta
(`^assets/products/[a-z0-9_-]+[.]webp$`, para las dos rutas y distintas entre
sí). Los nombres son deterministas —SKU normalizado, hash de identidad
producto/fuente y hash del contenido—, así que intercambiar master y thumbnail
entre SKU rompe el nombre y el binding, y la verificación falla.

Los archivos raw no se versionan. `--allow-empty` existe exclusivamente para
validar la estructura antes de tener material comercial.
