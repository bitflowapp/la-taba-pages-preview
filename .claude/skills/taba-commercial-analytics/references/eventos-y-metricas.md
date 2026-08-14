# Eventos existentes, campos y transporte

## Lo que ya está implementado

js/growth/analytics.js —en `feature/taba2-commerce-growth-engine`, no integrado
en la candidata de producción— define la cola first-party del motor de
merchandising.

Tipos de evento que el módulo acepta hoy:

`promo_impression` · `promo_click` · `promo_dismiss` · `product_view` ·
`add_to_cart` · `checkout_start` · `purchase`

Un tipo fuera de esa lista **se descarta**. No se registra "por las dudas".

Campos permitidos en el payload (lista blanca; todo lo demás se descarta al
registrar): `campaignId`, `placement`, `productId`, `categoryId`, `comboId`,
`orderItems`, `quantity`.

Nótese qué **no** está en la lista: nada del cliente. Ni id de sesión persistente,
ni dirección, ni texto libre. Agregar un campo a esa lista es una decisión de
privacidad, no un detalle de implementación.

Otros rasgos del módulo, con su razón:

- La cola vive en almacenamiento de sesión y tiene tope de eventos. Una cola sin
  tope crece hasta romper el almacenamiento del navegador y se lleva puesto el
  carrito.
- El módulo **no lee el reloj**: el llamador le pasa el tiempo. Eso es lo que
  hace que los tests sean deterministas.
- `setGrowthAnalyticsTransport(fn)` es la interfaz para un backend futuro. Hoy no
  hay transporte remoto: los eventos no salen del navegador.
- El embudo que arma es **por campaña y con alcance de sesión**.

## Nombres: el mapa entre el vocabulario y el código

El vocabulario de la skill es el nombre de negocio; el código tiene los suyos.
Cuando difieren, la skill nombra el hecho y el código nombra la implementación:

| Vocabulario | En código hoy |
|---|---|
| `checkout_started` | `checkout_start` |
| `checkout_completed` | `purchase` |
| `search` | señal `search_match` del bridge (no se persiste como evento) |
| `reorder` | no existe todavía como evento |
| `campaign_exposure` | `promo_impression` con `campaignId` |

Si algún día se unifican, se unifica **en una sola dirección** y se documenta la
fecha. Dos nombres para el mismo hecho conviviendo es cómo se pierde una serie.

## Impresiones honestas

Una impresión se cuenta cuando la pieza estuvo **50% visible**, medida con
IntersectionObserver, y se deduplica por época de vista. Contar el render como
impresión infla el denominador: la pieza aparece ignorada cuando en realidad
nadie la tuvo en pantalla.

Esta definición es la que hace comparables el frequency cap y el embudo. Cambiar
el umbral cambia las dos cosas a la vez.

## Qué hace falta para medir de verdad

Hoy la medición es local y de sesión. Para métricas de negocio reales
(conversión, AOV, recompra por cliente) hacen falta datos del lado del servidor,
que ya existen en los pedidos. La regla es:

- **Lo que pasó con dinero se mide del lado del servidor**, sobre los pedidos.
  Un evento de navegador puede perderse y no es evidencia de una compra.
- **Lo que pasó con la atención se mide del lado del cliente** (impresiones,
  clicks, vistas), y siempre con su alcance declarado.

Cruzar las dos fuentes exige una clave común; elegir esa clave es una decisión de
identidad y privacidad, no un detalle técnico.

## Checklist para un reporte comercial

1. Ventana temporal y zona horaria del comercio (no la del navegador que corre
   el reporte).
2. Denominador explícito de cada tasa.
3. Tamaño de cada segmento comparado.
4. Origen de cada número: cliente o servidor.
5. Qué falta: los huecos se nombran, no se interpolan.
