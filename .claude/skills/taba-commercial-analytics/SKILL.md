---
name: taba-commercial-analytics
description: Métricas y eventos comerciales de TABA2 — vistas de producto, búsqueda, carrito, checkout, conversión, abandono, ticket promedio, recompra e intención de categoría. Usar cuando se pida medir algo, agregar o renombrar un evento, armar un embudo o un reporte, definir una métrica, o revisar qué datos se están guardando de las personas.
allowed-tools: Read, Grep, Glob
---

# Analítica comercial de TABA2

Dueña de **qué se mide, cómo se llama y qué NO se guarda**. No decide qué se
muestra (`taba-merchandising`) ni qué se cobra (`taba-pricing-promotions`).

## Privacidad primero, porque después no se puede deshacer

- **First-party.** Los datos son del comercio, se guardan en su infraestructura y
  no se comparten con terceros de publicidad.
- **Recolección mínima.** Se registra el hecho, no la persona. Un evento guarda
  ids de catálogo, superficie y tiempos; nada más.
- **Sin datos personales.** Nombre, teléfono, correo, dirección, coordenadas
  exactas y documento **no entran** a un evento. Si hace falta correlacionar, se
  usa un identificador opaco, y se justifica por qué hace falta.
- **La consulta de búsqueda no se guarda.** Se guardan las categorías y la marca
  que esa búsqueda matcheó contra el catálogo. Una caja de búsqueda es un campo
  de texto libre: la gente escribe ahí cosas que nadie quiere tener guardadas.
- **Agregados, no eventos crudos, para el perfil.** El perfil de intención
  persiste puntajes por clave con su timestamp; nunca la secuencia de lo que hizo
  la persona.
- **Lista blanca de campos.** El registrador descarta cualquier campo que no esté
  declarado. Es la única forma de que un dato personal no entre por un `payload`
  que alguien amplió sin pensarlo.

## Vocabulario de eventos

Un nombre por hecho. Renombrar un evento parte la serie histórica: si hay que
hacerlo, se documenta la fecha del corte y se dice en cada reporte que lo cruza.

| Evento | Cuándo |
|---|---|
| `product_view` | se abre el detalle de un producto |
| `search` | consulta asentada, con las **categorías** que matcheó |
| `add_to_cart` | entra un ítem al carrito |
| `remove_from_cart` | sale un ítem del carrito |
| `checkout_started` | empieza el checkout |
| `checkout_completed` | el pedido queda confirmado |
| `reorder` | se repite un pedido anterior |
| `promo_impression` | pieza comercial **vista** (50% visible), deduplicada |
| `promo_click` | click en la pieza |
| `promo_dismiss` | descarte explícito de la pieza |
| `campaign_exposure` | exposición atribuible a una campaña |

Los eventos que ya existen en código, sus campos permitidos y los límites de la
cola están en
[references/eventos-y-metricas.md](references/eventos-y-metricas.md).

## Métricas: definición antes que número

Cada métrica se publica con su **denominador**. "Conversión 3%" sin decir sobre
qué no significa nada, y dos informes con el mismo título miden cosas distintas.

| Métrica | Definición mínima |
|---|---|
| Conversión | pedidos confirmados / sesiones con al menos una vista de producto |
| Abandono de carrito | carritos con ítems sin checkout completado / carritos con ítems |
| Abandono de checkout | checkouts iniciados sin completar / checkouts iniciados |
| AOV (ticket promedio) | suma cobrada / pedidos confirmados, **sin** envío salvo que se aclare |
| Tasa de recompra | clientes con ≥ 2 pedidos en la ventana / clientes con ≥ 1 |
| Intención de categoría | afinidad agregada por categoría, no una etiqueta de persona |
| Embudo de campaña | impresión → click → agregado → checkout → compra |

## Honestidad del alcance

El embudo local hoy tiene alcance de **sesión**: describe lo que esta sesión vio,
no conversión histórica. Presentarlo como histórico es inventar una medición.

Tres reglas que evitan los informes falsos:

- Decir siempre la ventana y el alcance junto al número.
- No proyectar valor de vida ni ahorro futuro más allá de los datos que hay.
- No comparar segmentos chicos sin declarar el tamaño. Con pocos pedidos, la
  diferencia entre dos segmentos es ruido con forma de hallazgo.

## Antes de agregar un evento

1. ¿Qué decisión se va a tomar con ese dato? Si no hay decisión, no hay evento.
2. ¿Se puede responder con un evento que ya existe?
3. ¿Qué campo mínimo alcanza?
4. ¿Sobrevive el evento a un cambio de UI, o está atado a un botón que va a
   desaparecer?

## Nunca

- Guardar datos personales, la query cruda de búsqueda, ni coordenadas exactas.
- Identificar a la misma persona entre navegadores o dispositivos sin una
  decisión explícita de identidad con su base legal.
- Mandar datos comerciales a un tercero de publicidad.
- Publicar una métrica sin denominador ni ventana.
- Reportar como conversión un embudo cuyo alcance es una sesión.
