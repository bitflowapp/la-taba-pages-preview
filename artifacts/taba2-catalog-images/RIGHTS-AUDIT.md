# Derechos de las fotografías del catálogo

Medido el 2026-08-18 sobre `feature/taba2-catalog-image-pipeline`, base `190b344`.

## Qué se puede publicar hoy

| | fotos de producto |
|---|---|
| auditadas en el repositorio | 173 |
| **publicables** | **9** |
| bloqueadas | 164 |

Las 9 son 4 master + 4 thumbnail nuevos (`LICENCIA_COMERCIAL`) y el recurso
propio de TABA (`PROPIO`).

## La autoridad, y hasta dónde llega

`TABA-AUT-2026-08-001`, en `catalog/autorizaciones-comerciales.json`.

- estado: **declarada**
- habilita: `LICENCIA_COMERCIAL`
- evidencia documental: **PENDIENTE**. `archivo: null`.

La compuerta documental sigue **abierta**. No se marcó como cerrada, y no
debería marcarse hasta que exista el documento del acuerdo o el paquete de
packshots provisto por cada marca. Lo que sí quedó acreditado es la procedencia:
cada asset registra su URL de origen, el SHA-256 del archivo fuente y el id de la
autoridad.

### Lo que la autoridad cubre

> «packshots provistos por la marca o su embotellador/importador, con fondo
> blanco»

Los cuatro packs entran de lleno: los publica **Coca-Cola Andina**, que es el
embotellador de esas marcas en Argentina, sobre fondo blanco, con la capacidad y
la cantidad exactas del SKU.

### Lo que NO cubre, y se respetó

**`trapiche-origen-malbec-750ml`** quedó afuera. El packshot es correcto,
exacto y de calidad —una botella sola, fondo blanco, sin sello de cantidad— y el
matcher lo asoció con confianza ALTA. Pero lo publica Coca-Cola Andina como
**distribuidor** del portafolio Peñaflor, y la autorización dice «la marca o su
embotellador/importador». Un distribuidor no está en esa frase.

Está descargado, medido y anotado en la auditoría con `status=PENDIENTE_DERECHOS`.
Publicarlo necesita que el titular amplíe el alcance, no que alguien lo mire de
nuevo: mirar la foto resuelve si es el producto correcto, no si se puede usar.

## Los 60 activos históricos: siguen bloqueados

120 archivos (60 master + 60 thumbnail) de `jumboargentina.vtexassets.com` y
`jumboargentina.vteximg.com.br`, todos en `pending_review`, con el manifiesto
entero en `publication_status: blocked`.

**No se reutilizó ninguno. No se reetiquetó ninguno. No se «blanqueó» ninguno.**
Hay un control negativo que falla si alguno se vuelve publicable, y el host de
Jumbo está en la lista de rechazados de la allowlist, escrito, para que el
rechazo sea una decisión y no un descuido.

## Dos defectos de derechos encontrados en el camino

### 1. El guard no entendía al pipeline que lo alimenta — P0, corregido

`scripts/lib/publishable-image-rights.mjs` leía los derechos como
`source.master.path` y `source.rights_status`, la forma del manifiesto histórico
(`schema_version 3`). El pipeline actual escribe `source.assets.master.path` y
`source.rightsStatus` (`schemaVersion 1`).

Consecuencia: **todo lo que produjera el pipeline quedaba «sin declarar», o sea
bloqueado**, para siempre y sin un solo mensaje de error. Falla cerrado, así que
nunca publicó de más — pero tampoco iba a publicar nunca nada, y eso se confunde
con «todavía no hay material». Antes del arreglo: 1 publicable de 165. Después: 9
de 173.

### 2. El validador aceptaba una contradicción — corregido

`RIGHTS_STATUSES` en `scripts/catalog-images/lib.mjs` incluía `APROBADOS`,
`PENDIENTE_DERECHOS` y `NO_AUTORIZADOS` además de los tres que habilitan. Como
esa lista se usa para validar filas **ya aprobadas**, una fuente podía declararse
`APROBADA` y `NO_AUTORIZADOS` a la vez y pasar. El vocabulario más ancho no era
permisivo: era una contradicción que el validador dejaba pasar. Ahora la lista es
la misma que exige `catalog_assets_rights_valid` en la base y la misma que usa la
vitrina.

## Una observación que no se tocó

`js/repositories/supabase_order_repository.js` declara
`rightsStatus: 'PERMISO_DOCUMENTADO'` cuando la cadena de imagen está completa.
Nuestros assets son `LICENCIA_COMERCIAL`. Los dos habilitan, así que la compuerta
funciona igual, pero el cliente afirma un estado de derechos que el asset no
tiene en vez de leer el suyo. Corregirlo pide que la consulta de productos traiga
`catalog_assets.rights_status`, que es una misión aparte.
