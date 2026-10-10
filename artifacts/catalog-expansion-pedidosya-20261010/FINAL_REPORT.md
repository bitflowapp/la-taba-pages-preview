# FINAL_REPORT · expansión del catálogo con PedidosYa Market Neuquén · 2026-10-10

**Estado general:** preparación completa, **ningún producto creado**, **ningún precio aplicado**, **ninguna imagen aprobada**. Todo lo que sigue necesita aprobación humana antes de tocar Supabase.

## Resumen de números

| Concepto | Valor |
|---|---|
| Referencias de PedidosYa (lista del prompt) | 144 |
| Equivalencia exacta con La Taba (ya existentes) | 7 |
| Ambiguos (no creados) | Corona Rubia 330 ml ↔ Corona Extra (1) · Portillo Salentein Malbec, tinto y rosado (2 filas) |
| Candidatos nuevos | **134** |
| De los 134: duplicados exactos con una ficha del pool de 92 | **7** (no crear; usar la ficha existente) |
| De los 134: duplicados probables (decidir antes de crear) | **5** |
| De los 134: nuevos pendientes | **122** |

## Imágenes

| Concepto | Valor |
|---|---|
| Imágenes descargadas desde fuentes permitidas | 34 (guardadas fuera del repo, no versionadas) |
| Fuentes utilizadas | Jumbo (proveedor aprobado, cervezas y aperitivos ya cargados) · Coca-Cola Andina / Peñaflor (distribuidor oficial) · Fratelli Branca (fabricante) · CCU (fabricante, sin packshot de la presentación) |
| SKU con fuente permitida consultada | 33 |
| SKU sin fuente autorizada para su marca | 94 |
| SKU con imagen **pre-revisada** como plausible (sin aprobación humana) | 13 |
| SKU con imagen dudosa | 3 |
| SKU sin imagen utilizable | 121 de 134 |
| Imágenes **aprobadas por una persona** | **0** |
| Imágenes con derechos **verificados** | **0**. Hay base de autorización, pero el acuerdo escrito no está archivado (ver abajo) |

**Pre-revisión visual:** la hizo quien preparó este reporte para orientar a la revisión. No es una aprobación. `scripts/catalog-images/approve.mjs` exige `--revisado-por` y la ejecuta una persona.

**Descartadas por identidad, en la pre-revisión:** Stella Artois Pure Gold en lugar de Lager; tres fotos de Trapiche sin la línea «Alaris»; Dr. Lemon Pomelo en lugar de Vodka; Gancia Sin Alcohol; Patagonia Estelar; Vera IPA en lugar de Session IPA; un pack de seis latas; Amstel con foto de lata.

**Foto repetida para dos productos:** Gancia Vodka Spritz Hibiscus aparece para «Gancia Lima Limón Hibiscus» y para «Gancia Vodka Hibiscus». Probablemente sea un solo producto con dos nombres.

## Derechos de uso

- La autorización `TABA-AUT-2026-08-001` cubre packshots del fabricante o distribuidor, con fondo blanco. Dos ampliaciones (2026-08-25 y 2026-08-26) suman distribuidor oficial, proveedor aprobado (ecommerce serios, sólo para cervezas y aperitivos ya cargados, con revisión individual) y las fuentes Fratelli Branca y CCU.
- **Falta la evidencia:** el documento del acuerdo no está en el repo (`evidencia_documental.pendiente = true`). Sin ese archivo, el asset no puede tener `rights_evidence_file`.
- **Los retailers no están en la lista de fuentes** salvo Jumbo, y sólo para las marcas ampliadas. Carrefour, La Anónima y PedidosYa no figuran en el allowlist: no se descargó nada de ahí. Según el propio allowlist, cambiar eso es una decisión comercial.

## Duplicados

- Los siete exactos, con su ficha del pool: Heineken Lata 710 Lager (`heineken-710ml`), Imperial Golden Lata 473 (`imperial-golden-lata-473ml`), Imperial Cream Stout 473 lata (`imperial-cream-stout-lata-473ml`), Trumpeter Malbec 750 (`trumpeter-malbec-750ml-local`), Rutini Cabernet Malbec 750 (`rutini-cabernet-malbec-750ml-local`), Gancia Americano 950 (`gancia-americano-950ml-local`), Aperol 750 (`aperol-750ml`).
- Los cinco probables: Schneider Rubia 710 (el pool dice lata y la referencia no lo dice), Trumpeter Reserva, Rutini Cabernet Franc Malbec, Campari, Smirnoff Red N°21.
- Gancia Americano 950 ml se mantiene separado del 450 ml en producción.
- Detalle completo: `DUPLICATE_REVIEW.csv`.

## Precios

- Los 134 nuevos llevan el precio original de PedidosYa, sin margen. Es precio **propuesto**, no aplicado. No hay costo medido para estos SKU, así que **no se afirma rentabilidad**. Ver `PRICE_REVIEW.csv`.
- Los 7 existentes tienen override por SKU en `catalog/price-overrides-pedidosya-20261010.mjs`, **inerte** hasta que el estado pase a `APROBADO_COMERCIAL`. Ver `COMMERCIAL_MARGIN_REVIEW.md` en la rama de precios.

## Publicación

- Todos los productos nuevos salen como `available = false` e `is_verified = false`, sin stock, sin orden de góndola.
- Todos los alcohólicos siguen cerrados por la compuerta de licencia (`alcohol_sales_enabled = false`).
- No se creó ningún pedido ni se ejecutó ningún cobro.

## Auditoría

- `PRODUCT_IMAGE_AUDIT.csv`: 134 filas con los campos pedidos (nombre, SKU, categoría, presentación, precio, URL de imagen, estado de derechos, archivo local, estado de importación, estado de publicación, problemas).
- `IMAGE_SOURCES.csv`: 47 filas (una por imagen descargada o fuente consultada sin candidato), con URL, host, hash SHA-256, dimensiones y pre-revisión.
- `IMAGE_RIGHTS_REVIEW.csv`: base de autorización, condiciones y evidencia por imagen.

## Staging y producción

- **Staging:** no ejecutado (ver `IMPORT_DRY_RUN.md`).
- **Producción:** no tocada. `PRODUCTION_UPDATED: NO`.
- **Pruebas automatizadas:** `node --test tests/price-overrides-pedidosya.test.mjs tests/gondola-neuquen.test.mjs` → 32 de 32 pasan. No corrí la suite completa (≈900 s según la memoria del repo).
- **Pruebas de carrito, checkout, PWA y responsive:** no ejecutadas. El cambio de catálogo no toca la UI, pero no lo probé.
- **Fuera de alcance:** el checkout no lo verifiqué contra el precio de la base (quedó pendiente desde el reporte anterior).

## Decisiones que necesito

1. ¿Los 13 SKU con imagen pre-revisada los revisa una persona con `catalog:images:approve`? Son: Andes Rubia Oro 473, Brahma Chopp 473, Andes IPA 473, Patagonia Vera IPA 473, Patagonia 24.7 Session IPA 473, Quilmes IPA 473, Andes Negra 473, Dr. Lemon Limón 1 L, Dr. Lemon Vodka 1 L, Gancia Vodka Hibiscus 473, Dr. Lemon Mojito 473, Fernet Branca 750 y 450 (estas dos con 640 px).
2. ¿Quién archiva el acuerdo con el titular o el paquete de packshots de cada marca? Sin eso no hay derechos verificados.
3. ¿Se amplía el allowlist a otras fuentes (Carrefour, La Anónima) o se mantiene como está? Es decisión comercial.
4. Los duplicados probables y el par Gancia Hibiscus: ¿cuál ficha se conserva?
5. El override de precios de los 7 existentes: ¿lo aprobás? Si sí, cambia `ESTADO` a `APROBADO_COMERCIAL`; la aplicación en producción sigue requiriendo tu aprobación aparte.
6. Stock y orden de góndola para los productos que se publiquen.

## Estado del PR

Ver la sección siguiente del chat: rama, commit y link del PR en borrador.
