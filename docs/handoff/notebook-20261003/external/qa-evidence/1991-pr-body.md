## Qué es esto

Auditoría de lanzamiento comercial contra **producción viva**, con un navegador
real. Siete defectos que ninguna suite podía ver, porque ninguno es un error de
lógica: son cosas que la tienda le dice a una persona.

El informe completo, con las mediciones, está en
[`LANZAMIENTO-COMERCIAL-FIN-DE-SEMANA.md`](LANZAMIENTO-COMERCIAL-FIN-DE-SEMANA.md).

## El defecto más caro

Un visitante nuevo agrega una bebida, abre el carrito y toca **«Confirmar
pedido»**. La tienda contesta:

> Ingresá un nombre de al menos 2 caracteres.

En esa pantalla **no hay ningún campo de nombre**: el nombre vive en Perfil. Es
el camino del 100 % de los clientes nuevos y termina en una instrucción
imposible de obedecer. Ahora el aviso dice lo de la tarjeta que ya está en
pantalla y el foco va a su botón.

La primera versión de ese arreglo estaba mal y **la atajó la suite**: cortaba
antes de intentar el pedido y rompió tres pruebas del handoff de Mercado Pago.
La versión final traduce un rechazo en vez de adelantarse a él, y sólo cuando el
rechazo apunta a un campo que existe y no se ve.

## Lo demás

| | |
|---|---|
| **D2** | el selector de entrega se dibujaba a media caja (157 px en 332) cuando el comercio ofrece un solo modo |
| **D3** | los packs no decían cuánto sale cada envase. Ahora: **«$ 1.425 por botella»**. Es una división, no una promoción |
| **D4** | «Pedidos online habilitados» → **«Estamos tomando pedidos»**; «el pedido se registra en el sistema del comercio» → «el local lo recibe y podés seguirlo desde Seguimiento» |
| **D5** | el Panel decía **«El sistema NO se está cuidando solo»** de forma permanente por dos credenciales de cobro que La Taba no usa, con la vigilancia corriendo cada 60 s |
| **D6** | `maplibre-gl.css` (unpkg) bloqueaba el pintado de la home. Con el CDN colgado 15 s: **15.332 ms** hasta el primer pintado. Ahora **96 ms** |
| **D7** | dos compuertas de release clavadas en versiones viejas: las dos **habrían rechazado la versión publicada ahora mismo** |

## Y una corrección comercial

`docs/comercial/ofertas-de-lanzamiento.md` recomendaba destacar el pack x12 como
«el mejor precio por litro del catálogo». La cuenta dice lo contrario:

| | precio | litros | $/L |
|---|---:|---:|---:|
| Coca-Cola 2,25 L | $ 5.900 | 2,25 | **$ 2.622** |
| pack x12 · 500 ml | $ 17.100 | 6,00 | **$ 2.850** |

El pack es **8,7 % más caro por litro**. Publicar aquella frase habría sido una
falsedad comercial en el fin de semana de apertura.

## Lo que NO toca

Ni un precio, ni el stock, ni una etiqueta, ni un pedido, ni una migración.
**Cero escrituras comerciales.**

Lo que falta para vender son cinco decisiones del comercio —el envío sin precio,
la cobertura sin exigir, los horarios sin cargar, el comercio sin contacto y dos
pedidos trabados desde el 18/08— y ahora hay un comando que las lista contra
producción:

```
npm run vender:listo
```

## Verificación

- **2191/2191** unitarias
- **470/470** E2E (Chromium + mobile-WebKit)
- `npm run check`, `migrations:validate`, `catalog:images:verify`,
  `deps:pinned:check`, `secrets:scan`: verdes
- `production:health`: **SANO** (antes salía con código 1 sobre una base sana)
- runtime `la-taba-runtime-v87-lanzamiento-comercial`, identidad firmada

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XwPryenkabSZLFTiJai7VM
