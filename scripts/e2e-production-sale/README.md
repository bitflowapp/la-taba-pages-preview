# Prueba de venta real, de punta a punta

Compra un producto en la tienda publicada, lo procesa desde el Panel, lo entrega
con el teléfono del repartidor y comprueba que el stock bajó exactamente uno.

**Esta automatización crea un pedido REAL en producción.** Por eso está armada
para no poder hacerlo por accidente.

## Lo que no hace, y no es una omisión

- **No escribe en la base.** El único acceso es `db-solo-lectura.mjs`, que
  rechaza cualquier sentencia que no sea un `SELECT` — ni siquiera acepta dos
  sentencias juntas o una llamada a una función que mute. Todo lo que se
  comprueba se comprueba mirando, y si el flujo real no produjo el efecto, eso
  es una falla del producto y se reporta como tal. **El harness no repara nada.**
- **No inventa inventario.** La recepción de mercadería sigue siendo física y
  manual: alguien cuenta las botellas y las carga desde el Panel.
- **No toca Mercado Pago**, ni sube comprobantes, ni mueve dinero.
- **No guarda contraseñas.** Las sesiones se crean a mano una vez y lo único que
  persiste es el estado del navegador.

## Las cuatro llaves

Para crear el pedido hacen falta las cuatro a la vez. Falta una y el harness
igual corre, pero en seco: mide, valida y reporta sin comprar.

```powershell
$env:TABA2_PRODUCTION_SALE_E2E="I_AUTHORIZE_ONE_REAL_PRODUCTION_ORDER"
npm run e2e:production-sale -- --production --create-real-order --confirmado-por-humano
Remove-Item Env:\TABA2_PRODUCTION_SALE_E2E
```

## Preparación, una sola vez

```powershell
npm run e2e:auth:customer    # abre el navegador, iniciás sesión vos
npm run e2e:auth:business    # idem, con la cuenta del Panel
$env:TABA2_E2E_DIRECCION_TEXTO="<la dirección tal como la muestra el checkout>"
```

Las sesiones quedan en `.local/e2e-auth/`, que está en `.gitignore`. Si vencen,
el harness dice `AUTH SESSION EXPIRED` y no compra nada.

La dirección aprobada no es decorativa: antes de confirmar, el harness compara
la dirección que muestra el checkout con ésa y **falla cerrado si difiere**. Una
prueba no puede terminar mandando un repartidor a un domicilio que nadie revisó.

## El ensayo, que es el modo normal

```powershell
npm run e2e:production-sale:dry
```

Comprueba comercio, producto, stock, precio, sesiones, teléfono del repartidor,
dirección y compuertas. No abre el checkout ni crea nada. Termina en
`DRY RUN GREEN` o en `DRY RUN BLOCKED · <motivo concreto>`.

## Una ejecución, un pedido

Cada corrida toma `.local/locks/production-sale-e2e.lock`. Si una corrida quedó
a medias, el lock **queda puesto a propósito** y la siguiente se niega a crear
otro pedido hasta que una persona mire qué pasó con el anterior. Un pedido de
producción huérfano se cierra a mano; no se tapa con otro pedido.

## El PIN

Se lee de la pantalla del cliente, como lo haría una persona — nunca de la base
ni de un log interno — se usa en el teléfono del repartidor y **no se escribe en
ningún lado**. Todo lo que sale a disco pasa por `evidencia.mjs`, que redacta
PIN, tokens, claves y teléfonos. El reporte dice que se leyó y que funcionó;
nunca cuál era.

## Evidencia

`artifacts/production-sale-e2e/<run-id>/` con capturas de cada estado,
`result.json`, `report.md` y `run.log`. Todo redactado.

## Qué se puede comprar

Un solo producto y una sola unidad, escritos en `contrato.mjs`. No se parametriza
desde la línea de comandos a propósito: un pedido de producción no es una
variable de entorno. Para probar otro producto se cambia el contrato, se lee el
diff y se vuelve a autorizar. Ese roce es la característica.
