# La Taba se prueba a sí misma

Un comando. Recibe la mercadería, la publica, la compra desde la tienda, la
procesa desde el Panel, la entrega con el teléfono del repartidor y comprueba
que el stock bajó exactamente uno. Después cierra todo, lo vuelve a abrir y
comprueba que lo que pasó sobrevivió.

```powershell
$env:TABA2_E2E_PHYSICAL_QTY="6"
$env:TABA2_E2E_PHYSICAL_CONFIRMATION="I_CONFIRM_6_PHYSICAL_UNITS_EXIST"
$env:TABA2_PRODUCTION_SALE_E2E="I_AUTHORIZE_ONE_REAL_PRODUCTION_ORDER"

npm run e2e:production-sale:auto -- --production --create-real-order `
    --confirmado-por-humano --auto

Remove-Item Env:\TABA2_E2E_PHYSICAL_QTY
Remove-Item Env:\TABA2_E2E_PHYSICAL_CONFIRMATION
Remove-Item Env:\TABA2_PRODUCTION_SALE_E2E
```

Sin las cuatro llaves de autorización es un **ensayo**: mide, valida, comprueba
las dos sesiones de navegador y no crea ningún pedido ni carga ningún stock.

```powershell
npm run e2e:production-sale:auto                  # ensayo
npm run e2e:production-sale:auto -- --aprovisionar  # ensayo que puede fabricar el cliente de prueba
```

**Esta automatización crea un pedido REAL en producción.** Por eso está armada
para no poder hacerlo por accidente.

## Nadie opera una pantalla mientras corre

No pide un Enter, no espera un «listo», no pide clicks, no pide una contraseña,
no pide copiar el PIN y no pide cambiar al teléfono. Termina sola: `PASS`,
`FAIL` o `BLOCKED`.

## La única cosa que una persona tiene que decir

Cuántas botellas hay realmente sobre el mostrador, y sólo cuando hay que recibir
mercadería. Eso no se puede medir por software.

Se declara **dos veces**, y las dos tienen que decir el mismo número:

```powershell
$env:TABA2_E2E_PHYSICAL_QTY="6"
$env:TABA2_E2E_PHYSICAL_CONFIRMATION="I_CONFIRM_6_PHYSICAL_UNITS_EXIST"
```

Si dicen números distintos, o falta una, no se recibe nada:
`PHYSICAL STOCK NOT ATTESTED`. Escribir el número dentro de una frase que hay
que leer entera es lo que convierte «6» en una afirmación.

## Los cuatro casos, decididos antes de tocar nada

| estado del producto | plan |
|---|---|
| sin stock, oculto | atestación → **recibir** → publicar → vender |
| con stock, oculto | publicar → vender (**no** se recibe de nuevo) |
| con stock, publicado | vender |
| corrida anterior sin cerrar | no se crea otro pedido: se diagnostica |

Una corrida repetida **nunca** se convierte en inventario adicional.

## Lo que no hace, y no es una omisión

- **No escribe en la base.** El único acceso es `db-solo-lectura.mjs`, que
  rechaza cualquier sentencia que no sea un `SELECT` —ni dos sentencias juntas,
  ni una llamada a una función que pueda mutar—. Todo efecto lo produce un botón
  de la aplicación; la base sólo se lee, para comprobar que el botón hizo lo que
  dijo. Si el flujo real no produjo el efecto, eso es una falla del producto y
  se reporta como tal. **El harness no repara nada.**
- **No llama a las RPC.** Ni a `apply_inventory_movement` ni a
  `set_commercial_product_publication`. Si el botón del Panel está roto, la
  prueba tiene que fallar: llamar a la RPC certificaría el servidor y dejaría el
  Panel sin probar, que es exactamente donde apareció el defecto de la clave de
  idempotencia.
- **No guarda contraseñas en el repositorio.** Ni en un `.env`, ni en un archivo
  temporal, ni en un argumento de línea de comandos —que cualquier usuario de la
  máquina puede leer del administrador de tareas—. Van al Credential Manager de
  Windows, y el valor viaja por entrada estándar.
- **No puede conseguirse una credencial administrativa.** Ningún módulo del
  recorrido nombra la clave de servicio ni sabe pedirla; hay una prueba que lo
  verifica archivo por archivo.
- **No lee el PIN de la base.** Se lee de la pantalla del cliente, se usa en el
  teléfono y no se escribe en ningún lado. La captura se toma con el número ya
  tapado en el DOM, así que la imagen que queda en disco nunca lo tuvo.

## Las tres identidades

| quién | cómo existe | cómo se renueva |
|---|---|---|
| **Panel** | cuenta dedicada `…+e2e@…`, rol `admin` | vuelve a entrar por la pantalla de ingreso con la contraseña guardada |
| **Cliente** | identidad **anónima** de la tienda, con perfil y dirección | se fabrica otra por las mismas pantallas, con la dirección aprobada |
| **Repartidor** | la sesión que ya vive en el teléfono | no se toca nunca |

El rol del Panel es `admin` y no `owner` porque es el más chico que alcanza:
recibir acepta `owner/admin/staff`, pero **publicar** acepta sólo `owner/admin`.
Se apaga con un `is_active = false` en su fila de `business_members`.

Alta, una sola vez:

```powershell
$j = (supabase projects api-keys --project-ref wwcpogltfgzgkrlilbcd `
    --reveal --output-format json | Out-String | ConvertFrom-Json)
$env:SUPABASE_SERVICE_ROLE_KEY = ($j.keys |
    Where-Object { $_.name -eq 'service_role' }).api_key
npm run e2e:provision:panel -- --confirm
Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY
```

## Todo se correlaciona por identidad

Ni «el último pedido», ni «el primer botón», ni «la dirección que dice Mendoza».

- el pedido, por su uuid: `[data-production-business-next="<uuid>"]`;
- la dirección, por el suyo: `[data-customer-address-id="<uuid>"]`;
- en el teléfono, por el código público, revalidado **antes de cada toque**.

No es prolijidad. El comercio tiene otros pedidos vivos, y el repartidor puede
llevar hasta tres entregas a la vez: «avanzar el primero» movería el pedido de
otra persona.

## El teléfono, que es la parte peligrosa

Volcar la pantalla → resolver el elemento por su `content-desc` → calcular el
centro → recién ahí tocar. Nunca una coordenada memorizada, y por una razón
medida: **«Cerrar sesión» del cajón y «Llegué» del mapa caen a la MISMA altura**
(y=2180). Un harness que tapeara «el botón de abajo» podría cerrar la sesión de
producción del repartidor creyendo que confirma una entrega.

Además hay lista negra explícita —cerrar sesión, rechazar, reportar, biometría,
abrir Maps— y una guarda que se niega a tocar nada si el pedido en pantalla no es
el de esta corrida. `force-stop` sólo se usa en la prueba de persistencia, y sólo
después de comprobar que no hay ninguna entrega viva.

## Archivos

| archivo | qué decide |
|---|---|
| `contrato.mjs` | lo único comprable, y las cuatro llaves |
| `identidades.mjs` | quién es quién, y la dirección aprobada |
| `atestacion-fisica.mjs` | la única entrada humana |
| `maquina-de-estado.mjs` | cuál de los cuatro casos, antes de tocar nada |
| `guards.mjs` | las compuertas, todas fallan cerradas |
| `db-solo-lectura.mjs` | la única puerta a la base, de una sola dirección |
| `secretos-windows.mjs` | dónde vive la contraseña, y cómo no se filtra |
| `sesiones.mjs` | sesiones que se renuevan solas |
| `panel-mercaderia.mjs` | recepción y publicación, por el Panel |
| `venta-real.mjs` | el recorrido de la venta |
| `rider.mjs` | el teléfono |
| `auto.mjs` | el runner |
| `lock.mjs` | una corrida, un pedido, como máximo |
| `evidencia.mjs` | qué queda escrito, y qué nunca |

## La evidencia

`artifacts/production-sale-e2e/<run-id>/`: `timeline.json`, `precheck.json`,
`recepcion.json`, `pedido.json`, `inventario.json`, `result.json`, `report.md`,
`run.log` y las capturas. Todo pasa por la redacción antes de tocar el disco:
PIN, tokens, claves y teléfonos.

## Si algo queda a medias

El lock se queda puesto **a propósito**. La corrida siguiente se niega a crear
otro pedido hasta que alguien mire qué pasó con el anterior: un pedido de
producción huérfano se cierra a mano, no se tapa con otro pedido.
