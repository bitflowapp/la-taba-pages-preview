# Candidata comercial de TABA2 — handoff

Qué es, qué contiene, en qué se diferencia de staging y en qué orden se
despliega el día que haya ventana exclusiva.

---

## HEAD candidato

```
rama      release/taba2-commercial-candidate
HEAD      90a28a1
base      66ba221  (test/taba2-first-human-physical-order)
worktree  D:\1212\worktrees\taba2-commercial-candidate
```

**No hubo merge.** Las tres declaraciones que componen esta candidata se
produjeron secuencialmente sobre la misma rama, así que ya estaban integradas
linealmente. La candidata es esa línea, aislada en su propia rama para poder
validarla sin que nadie la mueva y sin tocar la rama fuente.

Se verificó que `fix/taba2-location-truth` no aporta nada que falte:
`data/business-location.json` y `scripts/check-location-contract.mjs` son
idénticos, y los módulos del contrato de entrega existen sólo del lado de la
candidata —esa rama es anterior a `DELIVERY_LOCATION_REQUIRED`—.

---

## Commits integrados

| Commit | Declaración | Qué trae |
|---|---|---|
| `a790854` | STOREFRONT | Ciudad y provincia salen de la UX; el chip «Enviar a» deja de contradecir al checkout |
| `e63a4ff` | STOREFRONT | La góndola prioriza lo comprable: orden, categorías, +18, stock, resumen |
| `a49a88c` | STOREFRONT | Aviso de categoría sin precio y dos correcciones de accesibilidad |
| `01c49c6` | ONBOARDING | Readiness, planilla del negocio, importador seguro y `apply_commercial_catalog_batch` |
| `210365b` | ONBOARDING | La columna «foto» mide archivo, no ruta |
| `ffb016d` | ONBOARDING | Corrección de una cifra |
| `90a28a1` | CONTRATO | `price_status` impuesto por la tabla; la puerta comercial mueve el estado |

Y por debajo, ya en la base `66ba221`, los fixes de **DELIVERY_LOCATION** que el
checkout necesita: `9679e03` (el cliente confirma dónde vive y el punto llega al
Rider), `0c0b664` (el punto vuelve del pedido), `bd42f43` (confirmar el pin antes
de terminar de escribir ya no lo tira abajo) y `66ba221` (una dirección sin punto
ya no abre confirmando el Golfo de Guinea).

### Excluido explícitamente

`feature/taba2-pilot-ops` y las migraciones de Observabilidad
`20260807110000`–`20260807150000`, la reconciliación del mapa del Rider
`20260807155000`, ARCA, WhatsApp, Stories, Fable y Shelf. Nada de eso está en
las tres declaraciones del encargo.

---

## Migraciones nuevas

Tres, todas forward-only y aditivas. Ninguna toca una función existente salvo la
tercera, que redefine la que introdujo la primera.

| Orden | Archivo | Qué hace |
|---|---|---|
| 1 | `20260809050000_commercial_catalog_price_and_stock_batch.sql` | Crea `apply_commercial_catalog_batch`: la puerta segura para cambiar precio, stock y publicación de productos que ya existen |
| 2 | `20260809060000_commercial_price_and_stock_contract.sql` | Mide y remedia filas incoherentes, endurece `products_available_requires_verification` con `price_status='confirmed'` y `price > 0`, y suma `product_commercial_state()` |
| 3 | `20260809070000_commercial_batch_price_status.sql` | Redefine la puerta para que cargar un precio lo confirme |

**La 2 crea `public.commercial_contract_remediation`**, que deja constancia de
cada fila que se apagó al endurecer, con su precio, estado y stock previos. Si
queda vacía, el catálogo ya era coherente.

---

## Diferencias respecto de staging

Lo último que el lock de staging declara desplegado es el commit **`bd42f43`**
con caché `la-taba-runtime-v53-confirmar-antes-de-escribir`, más un deploy
posterior a **v54** anotado en la línea de tiempo del bug de ubicación.

| | staging | candidata |
|---|---|---|
| commit web | `bd42f43` (+ v54) | `90a28a1` |
| caché del service worker | `v53` / `v54` | **`v55-gondola-comercial`** |
| versión de assets | `?v=44` | **`?v=45`** |
| `js/app.js` | `?v=37` | **`?v=38`** |
| migraciones | hasta `20260808191000` | **+3** (`…050000`, `…060000`, `…070000`) |

En archivos: **41 archivos, +8.212 / −4.103** entre la base y la candidata.

Staging **no se tocó ni se leyó**: `taba2-staging-mutation.lock` sigue en
`STATUS=ACTIVO` a nombre de `TABA2_FIRST_HUMAN_PHYSICAL_ORDER`.

---

## Validación de la candidata

| Qué | Resultado |
|---|---|
| Los ocho invariantes de la integración | **30 / 30** |
| `npm run check` | verde |
| `npm test` | **1203 / 1203** |
| `npm run migrations:validate` | verde |
| `npm run secrets:scan` | verde |
| Readiness, planilla y precios unitarios al día | verde |
| Importador, dry-run sobre la planilla real | 81 filas, 0 cambios, 11 intactos |
| PostgreSQL efímero con todas las migraciones | **36 / 36**, con las siete transiciones |
| Playwright Chromium + WebKit móvil | **227 / 227** |
| Visual 320 / 360 / 390 / 432 × Chromium y WebKit | sin overflow, sin errores de página, sin assets 4xx |

### Los ocho invariantes

`node scripts/verify-commercial-candidate.mjs` los verifica juntos contra los
módulos reales, no contra una copia del contrato:

1. Un precio pendiente nunca se escribe como `$ 0` —seis variantes, incluida la
   fila incoherente `price_status='confirmed'` con `price=0`—.
2. El orden no prioriza pendientes, ni por recomendados ni por «precio menor a
   mayor».
3. Un combo que no ahorra no declara ahorro, y un componente sin precio no deja
   anunciar ningún número.
4. Cargar un precio lo confirma; un valor omitido preserva el estado; la
   republicación exige todas las compuertas.
5. Stock 0 y stock desconocido son estados distintos y ninguno se puede comprar;
   la tabla lo impone del lado del servidor.
6. Un delivery sin punto confirmado se rechaza con `DELIVERY_LOCATION_REQUIRED`;
   editar la calle invalida la confirmación; el retiro no exige punto.
7. Ciudad, provincia y código postal no volvieron a la UX, y el dato sigue
   viajando desde `OPERATING_AREA`.
8. El catálogo committeado no tiene un solo SKU de prueba, y tanto el importador
   como el servidor los rechazan.

### La carrera heredada

`business-windows-operations.spec.mjs:8` cae de forma intermitente bajo carga.
**No se tocó**, y en esta candidata **pasó**: la corrida completa dio 227/227.

Se reporta igual porque el verde de una corrida no la cierra. Está anotada desde
el 8 de agosto en `taba2-location-truth.txt` —«ese test tiene una carrera propia:
acepta un diálogo del navegador y hace el click siguiente sin esperar a que se
cierre»—, cayó en la corrida del encargo anterior sobre este mismo código, y ahí
mismo dio 12/12 en aislado con `--repeat-each=3`. Es decir: aparece y desaparece
según la carga del host, no según el código.

Es deuda de ese spec, del Panel, y está fuera del alcance de esta candidata. No
se modificó para obtener verde: el verde vino solo.

---

## Orden exacto para desplegar, con ventana exclusiva

Precondición: `taba2-staging-mutation.lock` libre y tomado por quien despliega.

```bash
# 0 · tomar el lock y confirmar que nadie más está mutando staging
#     (editar D:\1212\_claude-locks\taba2-staging-mutation.lock)

cd D:\1212\worktrees\taba2-commercial-candidate
$env:TEMP='D:\1212\_claude-tmp\candidate'; $env:TMP=$env:TEMP

# 1 · repetir el gate sobre el árbol exacto que se va a desplegar
npm ci
npm run check
npm test
npx playwright test
node scripts/verify-commercial-candidate.mjs

# 2 · ensayar las migraciones contra una base efímera ANTES de staging
node scripts/run-commercial-import-drill.mjs

# 3 · aplicar las migraciones a staging, EN ESTE ORDEN
#     20260809050000_commercial_catalog_price_and_stock_batch.sql
#     20260809060000_commercial_price_and_stock_contract.sql
#     20260809070000_commercial_batch_price_status.sql

# 4 · leer la constancia de remediación antes de seguir
#     select count(*), reason from public.commercial_contract_remediation
#      where migration = '20260809060000_commercial_price_and_stock_contract'
#      group by reason;
#     Si devuelve filas, son productos que estaban publicados sin precio
#     confirmado. Revisarlos con el negocio antes de publicar el frente.

# 5 · recién ahí desplegar el frente (Cloudflare Pages, rama staging)
#     La caché rota sola: v54 -> v55-gondola-comercial

# 6 · smoke sobre la URL publicada
#     · la home muestra precios, no «$ 0»
#     · el chip «Enviar a» nombra la dirección predeterminada
#     · el formulario de dirección NO pide ciudad ni provincia
#     · un delivery sin punto confirmado sigue bloqueando
```

**El orden importa.** La migración 2 endurece la restricción de disponibilidad;
si el frente nuevo llegara antes, no pasaría nada malo —falla cerrado en los dos
sentidos— pero la constancia de remediación es la única foto de qué había mal
antes de arreglarlo, y conviene leerla con la góndola vieja todavía en pantalla.

### Rollback

Las tres migraciones son aditivas y no borran datos. Para volver atrás alcanza
con redesplegar el frente anterior: el contrato endurecido no rompe al storefront
viejo, porque lo único que hace es impedir estados que ese storefront tampoco
sabía vender. `commercial_contract_remediation` conserva qué filas se apagaron y
con qué valores, así que revertirlas es un `update` acotado y auditable.

---

## Deuda que la candidata no cierra

- `products.price` sigue siendo `not null`. Se documentó por qué no se convirtió
  a nullable y qué haría falta para hacerlo.
- La carrera de `business-windows-operations.spec.mjs`.
- Los 83 SKU sin precio, el stock de los 81 de góndola y las 10 fotos que
  faltan: eso no es software, está en `ONBOARDING-CATALOGO.md`.
- El punto del local sigue con `human_verified: false`.
