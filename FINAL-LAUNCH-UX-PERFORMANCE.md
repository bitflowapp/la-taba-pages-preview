# Menos preguntas para comprar, y una bandeja que no se traba

Rama: `feature/taba2-final-launch-ux-perf` (desde `main` `31c900b`)
Fecha de las mediciones: 2026-08-27

---

## Lo que la medición cambió del plan

La auditoría recomendaba, para el panel, **actualización granular por
`data-inbox-order`** en vez del reemplazo total de `innerHTML`. Antes de
escribir una línea de eso, se midió dónde se iba el tiempo:

| Pedidos | Total | Construir el string | Parsear el HTML |
|---|---|---|---|
| 100 | 315 ms | **284 ms** | 31 ms |
| 500 | 7 510 ms | **7 435 ms** | 75 ms |

**El DOM no era el problema: era el 1 %.** Un motor de diff —el refactor más
caro y más riesgoso de la lista— habría atacado los 75 ms y dejado los 7 435
intactos. No se hizo, y ésa es la decisión mejor pagada de esta rama.

Un perfil de CPU señaló al culpable real: `normalizeProfileOrder` en el 41 % de
las muestras. `inboxOrderCard` llamaba a `buildCustomerSignals(TODOS los
pedidos, este)` **una vez por tarjeta**, y esa función normalizaba y ordenaba la
lista entera adentro. Con N pedidos eran N×N normalizaciones.

### Los tres cuadráticos, en orden de aparición

1. **`buildCustomerSignals` normalizaba la lista entera por tarjeta.**
   `createCustomerSignalsIndex()` lo hace una vez por render y lo comparte.
2. **`summarizeCustomerOrders` re-normalizaba el grupo por tarjeta**, y además
   se lo llamaba dos veces por tarjeta con la misma lista.
3. **El resumen por identidad se recalculaba por tarjeta.** Se cachea en el
   índice: depende sólo de la identidad.

## Resultado, medido

`node scripts/measure-business-inbox-performance.mjs` — modo demostración,
servidor local, pedidos clonados de uno REAL creado por el checkout.

| Pedidos | Render antes | Render después | Pedido nuevo antes → después | Nodos DOM | HTML |
|---|---|---|---|---|---|
| 50 | 78.9 ms | **38.2 ms** | 82.4 → 48.4 ms | 6 487 | 180 KB |
| 100 | 286.9 ms | **142.7 ms** | 298.4 → 144.1 ms | 9 357 | 354 KB |
| 500 | 4 925.9 ms | **1 622.9 ms** | 4 881.4 → 1 513.6 ms | 32 317 | 1 743 KB |

El «después» incluye la fila de contacto nueva (más HTML y más nodos que el
«antes»), así que la mejora está **subestimada**.

Con clientes distintos —el caso realista, frente a 500 pedidos de un mismo
teléfono— el render de 500 baja a 1 554 ms.

### Lo que no era velocidad

El banco mide algo que un promedio de milisegundos esconde: **qué se pierde**
cuando el panel se vuelve a dibujar.

| | Antes | Después |
|---|---|---|
| scroll | OK | OK |
| `<details>` abierto | **PERDIDO** | OK |
| foco | **PERDIDO** | OK |

En los tres tamaños, con cada evento de tiempo real. Traducido: Walter abre un
pedido para leer la dirección, entra otro pedido, y el detalle se le cierra en
la cara. Eso no se arregla yendo más rápido; se arregla acordándose. El panel
ahora captura qué detalles estaban abiertos, dónde estaba el foco y dónde el
scroll, y lo repone después de dibujar. Es la mitad del valor de un render
granular, sin motor de diff.

---

## Panel del negocio

### El teléfono, en la tarjeta

Estaba dentro de `<details> Ver datos y productos`. Llamar a quien hizo el
pedido —lo primero que hace un local cuando falta una aclaración o el timbre no
anda— costaba abrir el detalle primero. Ahora está en la tarjeta, con `tel:` y
`wa.me`: la misma convención que el panel ya usaba adentro del detalle, no una
inventada. Sin teléfono no se dibuja la fila; en modo vitrina sigue desactivado.

### `order_events` fuera del snapshot

`BUSINESS_ORDER_SELECT` traía `order_events(*)`: la bitácora completa de cada
pedido, por hasta 500 pedidos, en cada refresco, para dibujar una bandeja que no
muestra ni un evento.

Se pudo sacar porque **`statusHistoryFromRow()` ya tenía el respaldo entero**:
reconstruye el historial desde las columnas de fecha del propio pedido
(`accepted_at`, `preparing_at`, `ready_at`, `dispatched_at`, `arrived_at`,
`delivered_at`, `cancelled_at`). No es una degradación inventada acá: ese camino
ya existía para los pedidos sin bitácora, y `business-ops.js` —que ordena la
cola por antigüedad de actividad— recibe el mismo `statusHistory` que antes.

El único otro consumidor, `lastEventSequence`, no lo lee nadie en producción.

La bitácora exacta se pide por pedido con `fetchOrderEvents(orderId)`. El
validador se relajó **sólo** para su ausencia: si llegan eventos, se siguen
exigiendo bien formados.

### Más de 500 pedidos activos ya no apaga el panel

`fetchBusinessOrderSnapshot` devolvía `ok: false` con
`BUSINESS_INBOX_LIMIT_EXCEEDED` y el panel se quedaba **sin nada**: con la
bandeja desbordada, Walter no podía ni aceptar el pedido que acababa de entrar.

Ahora se conservan los 500 más antiguos —la consulta ya viene ordenada por
antigüedad y en una bandeja operativa el que espera hace más tiempo es el más
urgente— y el resultado viaja con `truncation`, para que se diga. Esconder
pedidos activos en silencio sería peor que el error que esto reemplaza.

---

## Cliente

**El cliente no está creando un perfil. Está haciendo un pedido.**

### Retiro: dos campos, sin salir del pedido

Elegir «Retiro en local» siendo cliente nuevo devolvía «Completá tu perfil para
continuar» con un botón que navegaba a `#profile`. Para retiro eso era TODO el
trámite —no hace falta ninguna dirección— y aun así costaba dos navegaciones y
perder el hilo.

Ahora el nombre y el WhatsApp se piden **en línea**, y se guardan por el MISMO
repositorio (`customerProfiles.saveProfile`) y con las MISMAS validaciones que
usa el editor de direcciones. No hay una segunda lógica de perfil.

`data-profile-block="incomplete"` se conservó a propósito: es lo que lee
`bloqueoDePerfilEnCheckout` para reemplazar un rechazo del servidor por un
mensaje accionable, y sostiene el defecto medido el 2026-08-25 —«Ingresá un
nombre de al menos 2 caracteres» sobre una pantalla sin ningún campo de nombre—.
Lo que cambia es que ahora el campo **sí está**, a un dedo de ahí.

### Delivery: los detalles, plegados

Arriba queda lo que define la dirección y sin lo cual no se puede guardar
—calle y número, exactamente lo que exige `validateAddressCandidate`—. Etiqueta
(con su default seguro, «Casa»), piso, departamento, barrio y referencias bajan
a «Agregar detalles de entrega».

**Excepción deliberada:** si el comercio EXIGE cobertura y todavía no hay barrio
elegido, el pliegue arranca **abierto** y el resumen lo dice. El barrio es una
de las dos entradas con las que el backend resuelve si puede entregar;
esconderlo devolvería un rechazo cuyo motivo no está a la vista, que es el mismo
pozo que este trabajo vino a tapar.

El punto del mapa **no** bajó al pliegue: sigue afuera y sigue siendo
obligatorio para delivery. Y un campo con error abre el pliegue antes de recibir
el foco.

### Recurrente: cero campos

Ya estaba resuelto (`compactCheckoutSummary`) y se verificó: con perfil e
historial, el checkout muestra Entrega / Contacto / Pago con «Cambiar», y ningún
formulario.

---

## Un defecto que introduje y que la prueba encontró

La primera versión del editor en línea **borraba lo tipeado al mostrar el error
de validación**: el re-render repintaba los campos desde el perfil vacío. Le
pedía a la persona que escribiera todo de nuevo justo cuando ya estaba por
comprar. Lo encontró la prueba «un teléfono inválido … NO borra lo que la
persona escribió», que falló antes de pasar. Se corrigió con un borrador en
estado, igual que hace el editor de direcciones.

---

## Pulido visual del catálogo: lo que la medición dijo que NO hiciera

El pedido asumía un catálogo con fondo gris plano, tarjetas «genéricas tipo
bootstrap», radios dispares y espacios accidentales. Antes de repintar nada se
midió, con `scripts/audit-catalog-visual.mjs`: lee los estilos COMPUTADOS en un
navegador real, en 320 / 390 / 430 / desktop.

**Hallazgos: 0. Antes y después.**

| Qué se buscó | Qué se midió |
|---|---|
| radios de componentes equivalentes | uniforme: `20px` en las 80 tarjetas, en los 4 anchos |
| altura de las imágenes de producto | idéntica entre productos; un solo `object-fit` |
| padding fuera de la escala | ninguno |
| áreas táctiles | ninguna por debajo de 44 px |
| contraste del texto | ninguno por debajo de AA |
| desborde horizontal | ninguno en 320 / 390 / 430 |
| ritmo vertical entre tarjetas | **altura idéntica** en las 8 primeras: 157 px a 320, 327 px a 390 |

Y las premisas concretas del pedido, contrastadas:

- **«El gris del fondo»** — el catálogo no es gris claro: es grafito `#101317`
  con la tarjeta en `#1d222a`, una escala de seis escalones documentada en
  `tokens.css` con sus ratios de luminancia medidos. El pedido pedía además «no
  convertir la tienda en dark mode si hoy no lo es»: ya lo es, por decisión.
- **«El rojo no puede llenar la pantalla»** — ocupa el **5,7 %** del viewport en
  390 y el **3,2 %** en desktop. Es acento, no inundación.
- **«El precio tiene que ser muy fácil de encontrar»** — es el elemento
  tipográficamente dominante: 21px/850 contra 15px/750 del nombre, ratio 1,4,
  con el razonamiento escrito al lado en `catalog.css`.
- **«Escala de espaciado 4/8/12/16/24/32»** — ya existe en `tokens.css`
  (`--space-1` … `--space-12`) y el catálogo la respeta.

### Lo único que sí se cambió

Dos valores escritos a mano que duplicaban un token existente:
`border-radius: 999px` → `var(--radius-pill)` y `border-radius: 18px` →
`var(--radius-lg)`. Valores idénticos, cero cambio visual —las capturas
«después» son iguales a las «antes»—; lo que se corrige es que un valor escrito
dos veces es un valor que algún día se desincroniza.

**No se hizo nada más, y eso es el entregable.** El propio pedido fija el
criterio: «si un cambio es subjetivo y no mejora claramente jerarquía,
consistencia o legibilidad, NO hacerlo». Tocar el fondo, la sombra o el peso del
CTA acá habría sido revertir decisiones deliberadas y documentadas —hay una
misión previa de pulido visual de este mismo catálogo— a cambio de una opinión.

Capturas comparables en `artifacts/catalog-visual-polish/{antes,despues}/`:
catálogo, producto agregado y carrito, en 320 / 390 / 430 / desktop.

## Alcance que NO se tocó

Precios, stock comercial, promociones, secretos de Mercado Pago,
`business_payment_settings`, activación de MP, `alcohol_sales_enabled`,
productos alcohólicos, Rider, DNS y el workflow de despliegue.
