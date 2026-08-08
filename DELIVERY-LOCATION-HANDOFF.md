# Confirmación geográfica obligatoria del destino · TABA2

## El problema, medido

El primer pedido humano se creó con modalidad `delivery`, dirección escrita a
mano y `delivery_latitude` / `delivery_longitude` **NULL**. Nada estaba roto: el
dato nunca había existido. Aguas abajo eso significa

- el Panel conoce sólo texto;
- el Rider no tiene destino y su mapa dice «no hay coordenadas autorizadas»;
- el seguimiento del cliente no puede dibujar la entrega;
- el enlace de Google Maps queda a merced de un geocodificador, que con
  «Mendoza 827» ya resolvió una vez en Zapala, a 175 km;
- no hay contra qué certificar el GPS ni la ruta.

## La regla

**Ningún pedido con modalidad `delivery` se crea sin un punto que el cliente
haya confirmado.** Retiro en local no exige nada geográfico: el punto de
encuentro es el mostrador.

Una confirmación son cuatro piezas **juntas**, o no es nada:

| pieza | dónde vive |
|---|---|
| `latitude` / `longitude` | `customer_addresses`, `orders`, snapshot del checkout |
| `location_source` | `gps` · `map_pin` · `geocoded_confirmed` |
| `location_confirmed_at` | el instante en que la persona apretó **Confirmar ubicación** |
| `location_confirmed_address` | huella del texto de dirección vigente al confirmar |

`accuracy` se guarda **cuando existe**: un pin marcado a mano no declara la
precisión de una medición GPS.

Escribir una dirección **no** es confirmar una ubicación. Recibir la posición del
dispositivo tampoco: el aparato dice dónde está el teléfono, no dónde hay que
tocar el timbre. El paso de pendiente a confirmado es siempre un acto explícito.

Si cambia el texto que determina el punto —calle, número, ciudad, provincia,
código postal— la confirmación vence y hay que volver a confirmar el pin. Piso y
departamento quedan afuera a propósito: nombran una unidad dentro del mismo
edificio y no mueven el pin.

## Por qué una columna nueva y no más valores en `source`

El contrato pide declarar el origen como `gps` / `map_pin` /
`geocoded_confirmed`. La columna histórica `delivery_address_source` **no puede**
recibir esos valores: en staging hay un trigger fuera de este repositorio
(`private.capture_rider_map_order_location_snapshot`, ver
`docs/migrations/remote-only/`) que copia ese valor a una tabla cuyo CHECK acepta
sólo `manual` / `gps` / `geocoder` / `previous_order` / `qa_fixture`. Ampliar el
vocabulario haría **abortar el alta del pedido**.

Por eso el origen del contrato vive en columnas propias y la histórica recibe su
proyección:

    gps                 -> gps
    map_pin             -> manual
    geocoded_confirmed  -> geocoder

## Dónde se impone

| capa | qué hace |
|---|---|
| Perfil (editor de dirección) | el paso es obligatorio; sin confirmar no se guarda la dirección |
| Checkout | una dirección sin punto no se puede elegir; si ninguna lo tiene, bloquea con salida a Perfil |
| `createOrderFromCheckout` (demo/sandbox) | rechaza con `DELIVERY_LOCATION_REQUIRED` |
| Repositorio Supabase | rechaza antes de gastar una reserva de stock o un intento de pago |
| `create_order_with_items` | rechaza **antes** de llamar a la capa que reserva stock |
| `create_checkout_session` | rechaza **antes** de crear la sesión y de reservar stock |
| `finalize_paid_checkout_session` | deriva a revisión manual (el dinero ya se movió: acá no se aborta) |
| trigger diferido en `orders` | red de seguridad: ningún delivery queda confirmado sin punto |

El respaldo diferido **relee la fila** al momento de confirmar la transacción. Se
midió que un trigger diferido común recibe la tupla del evento —la de antes del
UPDATE— y el camino de pedido directo completa el bloque `delivery_*` con un
UPDATE posterior.

## El punto tiene que estar EN EL INSERT

El Rider no lee las columnas del pedido: lee la instantánea que toma
`private.capture_rider_map_order_location_snapshot` en el `AFTER INSERT` de
`public.orders`, y esa foto es **inmutable** por contrato.

El camino de pedido directo insertaba el pedido y completaba `delivery_*`
después, así que la foto salía **vacía** aun teniendo el punto guardado al lado.
Se comprobó en la base local con el fixture del esquema remoto instalado. El pago
online no compartía el defecto porque inserta el pedido completo de una vez.

La función autoritativa deja el punto ya validado en un ajuste **local a la
transacción** y un trigger `BEFORE INSERT` lo aplica a la fila antes de que se
escriba, así que los triggers `AFTER` —incluido el remoto— ven la fila completa.

## Privacidad

- el punto exacto **no se revela al Rider antes del claim**: la revelación exige
  ser el rider asignado, con membresía activa, y el pedido después del claim.
  Verificado en los dos sentidos;
- se guarda **un** punto por dirección, no un historial: la confirmación pisa a
  la anterior;
- el cliente puede editar o eliminar su dirección; los pedidos ya despachados
  conservan su copia inmutable, que es lo que la entrega necesita;
- la demostración y la sandbox usan el destino demo del contrato de ubicación
  —una plaza, un espacio público—, así que nunca señalan dónde vive nadie.

## Qué se verificó

    npm test                    1150 en verde  (incluye 18 + 14 afirmaciones nuevas del contrato)
    npx playwright test          219 en verde  (Chromium + WebKit móvil)
    npm run location:delivery:db  21 afirmaciones contra PostgreSQL real

La verificación de base corre sobre una base **efímera** dentro del contenedor
local, con las 59 migraciones aplicadas más el fixture que reproduce el esquema
`private` que staging tiene ocupado en la versión `20260804090000`. No toca
producción ni staging, no lee datos reales y termina en `rollback`.

### Traza del pedido QA demostrativo

    1. cliente confirma   Antartida Argentina 2600, Neuquen -> -38.953900, -68.059600
                          origen=gps  precision=12.00 m  confirmado=2026-08-08T22:34:06Z
    2. pedido             LT-0007  origen_clasificado=qa  destino=-38.953900, -68.059600
    3. Panel              direccion=Antartida Argentina 2600, Neuquen  punto=-38.953900, -68.059600
    4. Rider pre-claim    customer_location = null
    5. Rider post-claim   {"source":"gps","latitude":-38.953900,"longitude":-68.059600,"accuracy_m":12.00}
    6. Google Maps        .../dir/?api=1&destination=-38.9539000%2C-68.0596000

Evidencia completa en `.taba-evidencia/delivery-location-confirmation.txt`.

## Dos defectos anteriores que aparecieron en el camino

Ninguno de los dos lo introdujo este trabajo. Aparecieron al intentar aplicar la
cadena de migraciones desde cero, que es lo que hacía falta para certificar el
contrato del lado del servidor.

1. **`20260806160000` no se podía aplicar sobre una base vacía.** Amplía el
   `returns table` de `get_rider_queue` y de `list_available_rider_orders`, y
   `create or replace` no puede cambiar el tipo de retorno: abortaba con
   «cannot change return type of existing function» y con ella toda la cadena
   posterior. **Corregido** anteponiendo el `drop function` y restituyendo
   después los permisos que el DROP se lleva puestos, para que una base
   reconstruida desde cero termine idéntica a una que aplicó las migraciones una
   por una. En una base que ya la aplicó no cambia nada.

2. **La cadena depende de objetos que sólo existen en staging.** A partir de
   `20260806160000` hay consumo directo de `private.rider_map_location_payload`,
   creada por una migración que no vive en este repositorio. Una base nueva no
   los tiene. **No corregido acá**: el arnés de verificación instala el fixture
   ya existente (`supabase/tests/fixtures/rider_map_location_contracts.remote.sql`)
   en el mismo punto de la historia en que staging lo tiene, que es la forma
   honesta de representar la realidad. Consecuencia a mirar aparte: hoy
   `npm run test:db:isolated` y el escenario 1 de
   `scripts/run-migration-collision-scenarios.mjs` no pueden pasar sin ese
   fixture. No forma parte del gate `npm run verify`.

## Lo que queda fuera, a propósito

- **Geocodificador.** No hay uno configurado. `geocoded_confirmed` está aceptado
  en el contrato pero **no tiene productor**: hoy el punto sale del GPS o del pin
  en el mapa. Cuando exista, no hay que migrar nada.
- **Centroide de calle.** No se usa ni se va a usar como destino confirmado.
- **Direcciones anteriores al contrato.** No se rellenan: inventar dónde vive
  alguien no es una migración. Quedan sin confirmar y la interfaz pide
  confirmarlas antes de la próxima compra.
- **Pedidos anteriores.** No se tocan y siguen siendo operables por el Panel y
  por el Rider.

## Declaración

`TABA2_DELIVERY_LOCATION_CONFIRMATION_FULL_STACK_CERTIFIED`
