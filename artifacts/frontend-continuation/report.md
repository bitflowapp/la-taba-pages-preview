# Informe — continuación del frontend de La Taba

Fecha: 2026-10-02.

## Resumen

La tienda dice la verdad en más situaciones que antes y el buscador responde
mucho más rápido. Nada de esto está publicado: no hubo fusión ni despliegue.

- **Buscador.** Escribir «coca zero» letra por letra daba «cocazero» y cero
  resultados. Arreglado. Y cada tecla redibujaba la tienda entera: pasó de
  162 ms a 53 ms de script por tecla en un teléfono lento simulado.
- **Estados.** Sin conexión, tienda lenta, abierto o cerrado, fuera de zona,
  agotado, filtros sin resultados: cada uno dice qué pasa, y ninguno muestra un
  error técnico.
- **Ficha.** El botón Atrás del teléfono cierra la ficha y el catálogo queda
  donde estaba.
- **Campañas.** Arte más cuidado, dos escenas nuevas, y reglas más estrictas
  sobre lo que una pieza puede decir. **Las cuatro siguen apagadas.**

El catálogo comercial **no** está listo: 12 de las 46 fichas esperan datos que
sólo puede confirmar Walter. Eso no lo resuelve el frontend.

Dos cosas salieron mal en el camino y están contadas en `review-findings.md`:
el primer CI de esta tanda dio un rojo real por un defecto mío (la leyenda
legal en dos renglones), y una de mis primeras decisiones —volver a consultar
la disponibilidad cada dos minutos— estaba mal planteada y la rehice.

```text
TABA_FRONTEND_CONTINUATION_REPORT

REPO:           bitflowapp/la-taba-pages-preview
WORKTREE:       la-taba-frontend-polish (aislado; ningún otro worktree se tocó)
BRANCH:         feat/taba-frontend-commercial-polish
HEAD_INITIAL:   0364a58
HEAD_FINAL:     93d87ef es el último commit con código y el que validó el CI; después sólo hay documentación
PR_129:         abierto, sin fusionar (c1dc3aa). Es la base de #131
PR_131:         abierto, borrador, apilado sobre #129, sin conflictos
COMMITS_NEW:    18 de código y pruebas (6519e31 … 93d87ef) más los de documentación

HOME:               hecho. Encabezado en dos renglones, abierto/cerrado según el servidor,
                    leyenda legal de alcohol en la banda. El primer «Agregar» sube 32 px en los
                    tres teléfonos; a 1366 × 768 pasa de 872 px (bajo el pliegue) a 741 px
CATALOG:            hecho. Cada tarjeta dice por qué no se puede comprar; filtros vacíos explicados
PRODUCT_DETAIL:     hecho. Atrás cierra la ficha sin mover el catálogo; el fondo no se desplaza
SEARCH:             hecho. Espacios, palabras de enlace, punto final; 162 → 53 ms de script por tecla
FILTERS:            hecho. Estado vacío con su causa y «Limpiar filtros»; el orden editorial no se tocó
CART:               hecho. Título sin repetir, mínimo de envío sobre el subtotal, aviso al vaciar
CHECKOUT_FRONTEND:  parcial. Sin conexión, respuesta que no llega (tope de 25 s), cerrado, fuera de
                    zona, franja de alcohol y canal no habilitado tienen su texto. El camino de
                    Mercado Pago no se tocó (está fuera del alcance) y tiene hallazgos abiertos
ANIMATION_ENGINE:   hecho. Arma, corre una vez y se queda quieta; no repite al volver a la vista
BEER_POUR:          hecho. Fondo oscuro, botella verde inclinada, líquido dorado, vaso, espuma,
                    burbujas y condensación. Sin logos ni sonido
COLD_CAN:           hecho
PRODUCT_DROP:       hecho
OTHER_CAMPAIGNS:    ice_reveal (ya estaba), spotlight_product y glass_fill (nuevas). No se hicieron
                    bottle_condensation, can_spin ni bubble_background: son variaciones de lo que
                    ya hay y no agregan nada que ayude a comprar

CHROMIUM:   PASS local sobre el código final (ver qa-results.md). CI: PASS (corrida 37051659570)
WEBKIT:     PASS local: estados de tienda 20 de 20, campañas 15 de 15. CI: PASS (corrida 37051659570)
MOBILE:     360 × 800, 390 × 844, 430 × 932, en los dos motores
DESKTOP:    1366 × 768 y 1920 × 1080, en los dos motores
PWA:        caché v137, hojas ?v=70, identidad firmada (204 archivos). Pruebas de PWA
            en verde en el CI
ACCESSIBILITY:  CRITICAL_ACCESSIBILITY_VIOLATIONS 0 (axe, WCAG 2.2 AA, Chromium y WebKit)

FPS_BASE:   59,6 home · 59,3 catálogo (teléfono, CPU 4×, con GPU) · 60,1 / 59,8 escritorio
FPS_FINAL:  59,7 home · 59,9 catálogo (teléfono) · 60,1 / 59,9 escritorio. Sin cambio
LCP_BASE:   teléfono 3.848 ms [3.140 – 3.896] · escritorio 1.768 ms [1.640 – 4.816]
LCP_FINAL:  teléfono 3.488 ms [3.444 – 5.732] · escritorio 2.308 ms [1.528 – 3.100]. Sin cambio medible
CLS_FINAL:  0 en teléfono · 0,006 en escritorio, igual que la base
IMAGE_BYTES_BASE:   1.034.131 (home, teléfono) · 471.164 (catálogo, teléfono)
IMAGE_BYTES_FINAL:  1.034.131 · 471.164. Sin cambio: esta tanda no tocó las fotos

CARD_REPLACEMENTS:   0   (5 min, Chromium y WebKit)
IMAGE_REPLACEMENTS:  0
IMAGE_REDOWNLOADS:   0   (caché real, contado en el servidor)
CONSOLE_ERRORS:      0
UNIT_TESTS:  CI: 2.857 de 2.858, 0 fallas, 1 omitida. En local 2.857 de 2.858: la que falla es
             un gate de Gradle del Rider que en esta notebook se queda sin tiempo
E2E:         CI: 732 pasadas, 4 omitidas, ninguna necesitó reintento. Local: 132 pruebas
             en Chromium y 35 en WebKit sobre el código final, todas en verde
CI:          VERDE: 37051659570 sobre 93d87ef. Antes, dos rojos de 1 prueba cada uno, los dos
             míos: 36974637300 (0197ba5), defecto del producto —la leyenda legal—, y
             36990439592 (3202177), defecto de la prueba nueva que lo cubría

P0:  0
P1:  0 abiertos de esta tanda
P2:  0 abiertos de esta tanda. Quedan abiertos hallazgos de auditoría fuera del alcance
     (Mercado Pago, totales de pedidos): ver review-findings.md
P3:  5 decisiones abiertas a propósito: ver review-findings.md

FRONTEND_READY:             YES para revisión (CI verde). Falta un teléfono físico y Safari real
CATALOG_TECHNICALLY_READY:  YES
ANIMATION_ENGINE_READY:     YES, y apagado. Encender una campaña es una decisión comercial
COMMERCIAL_CATALOG_READY:   NO
PRODUCTS_PENDING_WALTER:    12
EVIDENCE_PATH:              artifacts/frontend-continuation/
FINAL_VERDICT:              listo para revisión; no listo para vender
```

## Qué cambió, por superficie

**Home.** El nombre del local y su estado comparten renglón; el rubro y la
dirección van debajo. El estado dice «Cerrado · Abrimos hoy a las 19:00» sólo
cuando el servidor lo informa con horario exigido; si no hay dato no se inventa.
Agregar un producto ya no mueve la tarjeta. La banda de cervezas lleva la
leyenda que pide la ley 24.788.

**Catálogo.** «Próximamente», «Agotado» y «No disponible» en vez de un genérico
«sin precio publicado» sobre productos que sí tenían precio. El botón que no se
puede usar se ve deshabilitado. Los filtros que no dejan nada lo dicen.

**Buscador.** Acepta espacios, ignora «de», «en», «sin» cuando sobran, y tolera
el punto que el teclado agrega solo. No autocorrige ni pone mayúsculas.

**Ficha.** Entra al historial: Atrás la cierra. Cerrarla con la X no deja un
paso fantasma.

**Carrito.** El nombre no se repite. El mínimo de envío se calcula sobre el
subtotal y sólo aparece con una entrega resuelta.

**Red.** «Sin conexión» ya no tapa la barra de navegación. Si el catálogo tarda
más de 12 segundos, la tienda lo dice y ofrece reintentar. El alta del pedido
tiene un tope de 25 segundos y no se reintenta sola.

**Campañas.** Lata y botella con volumen y brillo, sin logos. La escena se
dimensiona por el alto real de la banda. Cerrar un anuncio lo cierra en ese
lugar. Una cifra en la pieza sólo puede venir del nombre o la marca del
producto.

## Lo que necesita una decisión del propietario

1. **Los 12 productos pendientes.** Precio, stock, presentación o SKU dudosos.
   No se aprobó ninguno en nombre de Walter. La lista está en
   `artifacts/frontend-commercial-polish/catalog-audit.md`.
2. **Encender campañas.** Cada una necesita `enabled: true` y una aprobación con
   referencia. Hoy hay cero encendidas.
3. **El horario.** El rótulo «Cerrado» sólo aparece si el backend exige horario.
   Si el local quiere mostrarlo, hay que cargar el horario y exigirlo.
4. **Qué hacer cuando la consulta de disponibilidad falla.** Hoy la tienda no
   bloquea y decide el backend al crear el pedido. La alternativa es conservar
   el último «cerrado». Detalle en `review-findings.md`.
5. **La foto de la banda de cervezas** deja ver la etiqueta de una marca. Es
   anterior a esta tanda; conviene confirmar los derechos de esa imagen antes
   de publicar.
6. **Fusionar.** #131 está apilado sobre #129, que tampoco está fusionado. El
   orden y el momento son del propietario. No se fusionó ni se desplegó nada.

## Dónde mirar

- `qa-results.md` — pruebas, estrés, accesibilidad y performance, con lo que no
  se pudo medir.
- `review-findings.md` — las dos revisiones adversariales, el rojo del CI y lo
  que queda abierto.
- `before/`, `after/`, `videos/` — capturas y grabaciones.
