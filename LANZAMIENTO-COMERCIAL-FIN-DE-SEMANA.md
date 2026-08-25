# La Taba — lanzamiento comercial del fin de semana

Auditoría del **2026-08-25** sobre producción viva (`https://la-taba.pages.dev`,
Supabase `wwcpogltfgzgkrlilbcd`). La pregunta que contesta este documento no es
si el software funciona —funciona, y lo dicen 2.191 pruebas unitarias y la
suite E2E completa— sino ésta:

> ¿Puede entrar tráfico real ahora y convertirse en pedidos reales sin
> intervención técnica?

La respuesta corta: **el software sí; el comercio todavía no**. Faltan cinco
decisiones que ningún gate puede tomar. Tres se resuelven en el Panel en
minutos; una no tiene pantalla todavía y otra necesita el teléfono del
repartidor. Este documento las nombra una por una y deja un comando para volver
a comprobarlas cuando estén hechas.

```
npm run vender:listo
```

---

## 1 · Las cinco decisiones que faltan

Salida real del comando, contra producción, al cierre de esta auditoría:

| # | Qué falta | Dónde se resuelve | Por qué importa este fin de semana |
|---|---|---|---|
| 1 | **El envío dice $ 0 y el mínimo $ 0, y los escribió un guion de plataforma, no el comercio** | Panel → Horarios y cobertura → Envío y pedido mínimo | Cada entrega del fin de semana sale gratis. Es el único «descuento» que la tienda publica hoy y nadie lo decidió |
| 2 | **La cobertura no se exige** | Panel → Horarios y cobertura → Zonas de entrega → Empezar a exigir | Se acepta un pedido a **cualquier** dirección del planeta. El tope por distancia **no está disponible** — ver §1.3 |
| 3 | **No hay horarios cargados** | Panel → Horarios y cobertura → Horario de atención | La tienda figura abierta las 24 h y, cuando cierra, no puede decirle al cliente cuándo vuelve |
| 4 | **El comercio no publica teléfono ni WhatsApp** | **no hay pantalla** — ver §1.2 | Un cliente con un problema no tiene a dónde escribir |
| 5 | **LT-0001 y LT-0002 siguen abiertos** | teléfono del repartidor, o cancelar desde el Panel | Ocupan **2 de las 3** entregas activas del único repartidor y generan 2 alertas WARNING permanentes desde el 18/08 |

Ninguna es un defecto del software. Las cinco son estado del negocio — con una
salvedad: la 4 **no tiene pantalla** que la resuelva, y eso sí es una falta del
producto (§1.2).

### 1.1 · El envío, con la prueba

No es una sospecha: la propia auditoría de la base lo registra, y el Panel lo
muestra en pantalla.

```
business_config_audit · scope=delivery_pricing · actor_kind=service · actor_id=null
  antes:   delivery_fee=null   minimum_delivery_subtotal=null
  después: delivery_fee=0      minimum_delivery_subtotal=0
  2026-08-18 01:11:26Z
```

> Panel → Horarios y cobertura → *Qué se cambió*:
> **«El servidor editó envío y mínimo 17/08/2026, 22:11 — envío — → 0 · mínimo — → 0»**

**Y ese cero no sólo puso un precio: abrió la puerta.** `resolve_delivery_zone`
falla cerrado mientras la tarifa es NULL:

```sql
if v_business.delivery_fee is null then
  return jsonb_build_object('eligible', false, ..., 'detail', 'business_fee_missing');
end if;
```

Con la tarifa en NULL el servidor **no entrega nada**. El guion que escribió el 0
saltó ese guardián sin que nadie lo decidiera. Si el comercio quiere regalar el
envío el fin de semana de apertura, perfecto —pero que sea una decisión escrita,
guardada desde el Panel.

**No se tocó.** Fijar un precio comercial no lo puede hacer una auditoría.

### 1.2 · El contacto: la RPC existe y nadie la llama

`set_business_whatsapp_contact(business_id, teléfono, verificado)` está en la
base, exige rol `owner`/`admin`, valida entre 8 y 15 dígitos y separa la
rotación del número de su verificación. Está bien hecha. **Ningún archivo del
cliente la llama.**

La única pantalla del proyecto con un campo de WhatsApp vive en
`js/business.js` —el tablero de demostración— y guarda con
`updateBusinessConfig`, que escribe en el estado del navegador y no en el
servidor. En producción esa superficie se vacía (`clearDemoOperationalSurfaces`)
y el Panel real no tiene esa pestaña.

Además el cliente no muestra un número sin `whatsapp_verified = true`
(`get_public_business_contact`), así que publicar de verdad son las dos cosas:
cargar el número y verificarlo.

**Qué significa hoy:** el Perfil del cliente dice «A confirmar con el local» y
no hay forma de cambiarlo desde ninguna pantalla. Se corrige ejecutando la RPC
con una sesión owner/admin, o agregándole al Panel el formulario que le falta.
No se hizo acá porque el dato —qué número publicar, y si publicar uno— es del
titular, y construir el formulario no lo desbloquea.

### 1.3 · El tope por distancia no se puede encender

`set_delivery_pricing` se niega a fijar `delivery_max_radius_meters` sin un
punto del local **verificado por una persona**:

```
el tope de distancia necesita el punto del local verificado por una persona  (55000)
```

Y en producción `private.rider_map_business_locations` está **vacía**: no hay
ningún punto, verificado o no. La guarda es deliberada y correcta —un tope
medido desde un pin que nadie confirmó frenaría pedidos legítimos— pero el
efecto práctico es que **la única palanca de cobertura disponible este fin de
semana es la lista blanca de zonas**.

---

## 2 · Lo que se arregló, y qué se midió antes

Siete defectos encontrados **probando producción con un navegador real**, no
leyendo código. Todos corregidos en esta rama, con pruebas.

### D1 · El checkout pedía algo que la pantalla no sabe recibir — **el más caro**

Camino medido, con un visitante nuevo: agregar una bebida → abrir el carrito →
tocar **«Confirmar pedido»**. Respuesta:

> **«Ingresá un nombre de al menos 2 caracteres.»**

En esa pantalla **no hay ningún campo de nombre**: el nombre vive en Perfil. La
persona lee una instrucción que no puede obedecer. Es el camino del **100 % de
los clientes nuevos** — exactamente a quien se quiere convertir el viernes.

La pantalla ya decía bien lo que falta, en una tarjeta con su botón
(«Completá tu perfil para continuar» → *Completar Perfil*). Sólo faltaba que el
rechazo hablara ese idioma y llevara ahí.

**Cómo quedó:** cuando el rechazo apunta a un campo que existe y **no se ve**, el
aviso dice lo de la tarjeta y el foco va a su botón. El toast dice lo mismo que
el aviso: `showCheckoutInlineError` ahora devuelve el texto que quedó en pantalla.

**La primera versión estaba mal y la atajó la suite.** Cortaba *antes* de
intentar el pedido, y eso rompió tres pruebas del handoff de Mercado Pago: esa
suite completa nombre y teléfono escribiendo los campos ocultos, así que la
tarjeta seguía diciendo «incompleto» mientras el pedido era perfectamente
válido. Una compuerta que mira la **tarjeta** y un pedido que mira los **campos**
pueden discrepar, y el precio de discrepar es negarle la compra a alguien que sí
podía comprar. Por eso la versión final **traduce un rechazo** en vez de
adelantarse a él, y la condición es angosta: un rechazo por stock, por sesión
vencida o porque el pedido cambió durante el envío llega intacto.

### D2 · El selector de entrega se dibujaba a media caja

`.delivery-mode` es una rejilla de dos columnas. En producción el retiro está
apagado, así que «Delivery» ocupaba **157 px dentro de una caja de 332 px**
(medido a 390 px) y el hueco de la derecha se leía como un botón que no cargó.
Con una sola opción visible, ahora ocupa el renglón: `322 px`.

### D3 · Un pack no decía cuánto sale cada botella

$ 17.100 por doce botellas de 500 ml es el único precio del catálogo que el
cliente no puede evaluar de un vistazo. La tarjeta y la ficha ahora dicen
**«$ 1.425 por botella»** en todo producto con `units_per_pack > 1`.

No es una promoción: es una división. No afirma ahorro, no compara y no necesita
ningún costo —que además **no existe**: `unit_cost` está en NULL en los 72
productos de producción.

### D4 · Dos textos hablaban en idioma de sistema

| antes | ahora | dónde |
|---|---|---|
| «Pedidos online habilitados» | **«Estamos tomando pedidos»** | home |
| «Al confirmar, el pedido se registra en el sistema del comercio.» | **«Al confirmar, el local lo recibe y podés seguirlo desde Seguimiento.»** | checkout |

El chip **no dice «Abierto»** a propósito: sin horarios cargados la aplicación no
sabe si el local está abierto, sólo sabe que acepta pedidos.

### D5 · El Panel gritaba «El sistema NO se está cuidando solo» — con la vigilancia al día

El titular de *Cómo viene el sistema* se calcula desde las filas rojas, y una fila
se ponía roja porque faltaban dos credenciales del **despachador de cobros**
—`taba_payment_worker_url` y `taba_payment_worker_hmac_secret`—. La Taba no cobra
online: `business_payment_settings` tiene cero filas.

Resultado: el Panel decía **permanentemente** que el sistema no se cuida solo,
mientras tres renglones más abajo la vigilancia decía «Al día · revisó toda la
operación hace 29 segundos». Es alarma de humo sin humo, y su costo se cobra el
día que hay fuego.

Ahora la distinción la hace un dato que ya estaba: **si hay cobros esperando,
reintentando, en vuelo, fallados o abandonados**, la credencial que falta los
tiene frenados y sigue siendo crítica. Con la cola en cero es configuración
pendiente. Tres pruebas nuevas fijan las dos ramas.

### D6 · Una hoja de estilos de un tercero decidía cuándo se veía la tienda

`maplibre-gl.css` viene de **unpkg.com** y estaba declarada como hoja normal en
el `<head>`: en el camino crítico de pintado de la home, que no la usa —esas
reglas son del mapa, que vive en Seguimiento—.

Medido en Chromium a 390 px, contra producción:

| unpkg | primer pintado |
|---|---:|
| normal | 624 ms |
| **caído** (falla rápido) | 508 ms |
| **colgado 15 s** | **15.332 ms** |

Un CDN que se cae no hace daño: el navegador falla rápido y sigue vendiendo. Uno
que **no contesta** deja la tienda en blanco todo el tiempo que tarde, y ése es
el modo de falla probable de un servicio gratuito un viernes a la noche.

Con `media="print"` + `onload`, el mismo escenario de 15 s da **96 ms**. El
`integrity` y el `crossorigin` no se tocaron. Dos pruebas E2E nuevas fijan las
dos mitades: que no bloquee, y que igual termine aplicada —una hoja que no
bloquea y tampoco llega es un mapa sin estilo, que es peor—.

**Lo que queda abierto y se declara:** el `<script>` de MapLibre lleva `defer`,
y un `defer` colgado retrasa `DOMContentLoaded` y con él el arranque de
`app.js`. Medido por separado: con la hoja arreglada y el **script** colgado
15 s, el primer pintado es de 52 ms pero la aplicación queda inerte 15.219 ms.
La tienda se ve y no responde. Se puede cerrar de dos formas —`async` en vez de
`defer` (cada lugar que usa `maplibregl` ya lo lee de forma perezosa y con
comprobación de capacidad, así que el orden no lo necesita) o alojar el archivo
en el propio sitio (1 MB, entra en el precache)—. **No se hizo en este sprint**:
las dos cambian el orden de arranque o el grafo de precache, y no es lo que se
toca la semana que abre la tienda.

### D7 · Dos compuertas de release estaban clavadas en versiones viejas

Las dos **habrían rechazado la versión que está publicada ahora mismo**:

| gate | decía | la verdad al 2026-08-25 |
|---|---|---|
| `scripts/preflight-staging-package.mjs` | `ESPERADO.app = '?v=46'` | `index.html` cargaba `app.js?v=47` desde `eb1f33d`, que **es producción** |
| `scripts/production-health-check.mjs` | `EXPECTED_LEDGER = 103`, última `20260816122000` | 114 migraciones, última `20260825160000` |

La sonda de salud salía con **código 1 sobre una base perfectamente sana**: una
alarma que suena siempre es una alarma que nadie mira, y es la que hay que poder
correr sin pensar el fin de semana que abre la tienda.

Las dos ahora **derivan** su expectativa del repositorio en vez de repetirla a
mano, y hay una prueba nueva que fija las cuatro agujas del preflight contra
`index.html`. Después del arreglo, `production:health` da **SANO** y sale 0.

---

## 3 · Lo que se midió y está bien

### Home — 390 px, iPhone y Android

| medición | resultado |
|---|---|
| `domcontentloaded` | 851 ms (Android) · 1.221 ms (WebKit) |
| aplicación lista | 869 ms · 1.250 ms |
| desborde horizontal a 320 / 390 / 430 / 1440 px | **0** |
| objetivos táctiles bajo 44 × 44 px | **0** |
| primer precio | y = 470 px, dentro de la primera pantalla |
| primer «Agregar» | y = 498 px |
| errores de consola | 0 |

Sobre el pliegue, en orden: marca · **Delivery · Mendoza 827, Neuquén** ·
estado · buscador · categorías · **Recomendados del local** con foto, precio y
botón. La primera pantalla vende.

### Checkout

Con perfil completo, en producción: **0 errores de consola, 0 respuestas ≥ 400**,
dirección elegida y confirmada, resumen correcto, botón habilitado. El camino
es corto: home → agregar → carrito → (perfil y dirección ya guardados) → medio
de pago → confirmar.

### Los caminos de error, probados en producción sin crear ningún pedido

| caso | resultado |
|---|---|
| pedir más unidades que el stock | el carrito llega **exactamente** a 5 —el stock real— y el `+` se deshabilita. Sin sobreventa, sin error crudo |
| doble toque en Confirmar | un solo intento; ningún pedido duplicado |
| refrescar con el carrito lleno | el carrito sobrevive |
| volver atrás desde el carrito | vuelve al catálogo, carrito intacto |
| tienda caída al arrancar | «No pudimos abrir la tienda. Puede ser tu conexión. Probá de nuevo: **tu pedido no se perdió**.» |

### Seguimiento

La vista existe en los siete estados y el mapa es la superficie, no un adorno
condicional: sin ningún pedido dice **«Seguí tu pedido — cuando hagas una compra
vas a poder seguir el recorrido del Rider desde acá»** con su llamada al
catálogo, que es un estado válido del producto y no un hueco.

**Qué NO se volvió a ejercitar acá:** el camino con un pedido vivo. Exige un
pedido real, y crear uno que no se puede cerrar es exactamente lo que no había
que hacer (§5). Ese camino quedó certificado en esta misma producción el
2026-08-22, y la suite E2E de seguimiento —llegada, modo seguir, expiración
terminal, mapa honesto— está verde en esta rama.

**Limitación conocida, no corregida:** el seguimiento muestra el último pedido
de ese navegador y no hay forma de elegir otro. Un cliente que pide dos veces ve
el segundo. No es un bloqueo de lanzamiento —el pedido que importa es el último—
pero está escrito para que no sorprenda.

### Medios de pago — lo que hay de verdad

- **A coordinar con el local**
- **Efectivo al recibir**

Y nada más. Mercado Pago **no aparece** en el selector, porque
`business_payment_settings` tiene cero filas y la disponibilidad falla cerrada.
La tienda no simula Checkout Pro en ningún lado. Los **combos** tampoco llegan
al cliente, por la misma razón y por una segunda: la ruta directa de pedidos los
rechaza porque el precio de un combo lo deriva Checkout Pro.

### La cadena completa YA ocurrió en esta producción — y dónde se detuvo

No hace falta creerle a una suite: `order_events` guarda lo que pasó de verdad
con los dos pedidos reales, y la cadena entera está ahí.

```
LT-0002  19:01:31  order.received                ← el cliente compró
LT-0002  19:09:41  order.status_changed          ← el Panel lo aceptó
LT-0002  19:09:48  order.status_changed             preparando
LT-0002  19:09:56  order.status_changed             listo
LT-0002  19:10:02  order.rider_offered           ← ofrecido al repartidor
LT-0002  19:30:55  order.rider_offered              (reofrecido)
LT-0002  19:31:15  order.rider_accepted_offer    ← el teléfono aceptó
LT-0002  19:36:48  order.status_changed          ← retirado
LT-0002  …         order.tracking_access_recovered  (17 veces, hasta 00:06)
```

Cliente → Negocio → Rider → Seguimiento, con fechas, en el Supabase productivo.
LT-0001 hizo lo mismo el 18/08 y además registró un `order.rider_issue_reported`.

**Dónde se detuvo, las dos veces: en `delivered`.** Ese paso es el que pide el
PIN en el teléfono del repartidor, y es exactamente el que no se puede ejecutar
sin el aparato. Por eso los dos pedidos siguen abiertos y por eso este sprint no
creó un tercero.

Abierto con la identidad dedicada (`admin`), 1280 px, **0 errores de consola**.
Tablero con contadores, alertas escritas en castellano llano con su riesgo y su
acción, y las pestañas de operación completas: Pedidos, Preparación, Recepción,
Horarios y cobertura, Dispositivos, Abrir/Cerrar.

### Vigilancia

| medición | resultado |
|---|---|
| barridos | cada 60 s, `status=ok`, **0 fallos en 24 h** |
| cron activos | 4 de 4, ninguno con fallos |
| alertas críticas | 0 |
| alertas abiertas | 2 WARNING — las dos son los pedidos trabados de la §1 |
| `production:health` | **SANO** (después del arreglo D6) |

El vigía funciona y dice la verdad: las 5.195 y 2.104 repeticiones de
`RIDER_SIGNAL_STALE` son exactamente los dos pedidos que nadie cerró.

---

## 4 · Las ofertas: qué se puede y qué no

Ver `docs/comercial/ofertas-de-lanzamiento.md`, **reescrito** en esta rama.

**Corrección que importa:** la versión anterior recomendaba destacar el pack x12
como «el mejor precio por litro del catálogo». La cuenta dice lo contrario:

| producto | precio | litros | $/L |
|---|---:|---:|---:|
| Coca-Cola Original 2,25 L | $ 5.900 | 2,25 | **$ 2.622** |
| Coca-Cola Original pack x12 · 500 ml | $ 17.100 | 6,00 | **$ 2.850** |

El pack es **8,7 % más caro por litro**. Publicar aquella frase habría sido una
falsedad comercial en el fin de semana de apertura.

**Ningún descuento se puede aprobar todavía:** `unit_cost` está en NULL en los 72
productos, así que no hay margen que verificar. Lo único aplicado en este sprint
es el precio por envase de los packs (D3), que no cambia ningún precio.

---

## 5 · Lo que NO se pudo cerrar acá

### Rider — compuerta física

El teléfono del repartidor (`ZY32LHS6PS`) **no aparece en adb**. Todo lo demás
del ensayo de venta real da verde:

```
Precheck ......... BLOCKED · RIDER_SIN_DISPOSITIVO
Business auth .... PASS
Customer auth .... PASS · cliente de prueba fabricado con dirección confirmada
```

Con el teléfono conectado, el gate exacto es:

```powershell
$env:TABA2_PRODUCTION_SALE_E2E="I_AUTHORIZE_ONE_REAL_PRODUCTION_ORDER"
npm run e2e:production-sale:auto -- --production --create-real-order `
    --confirmado-por-humano --auto
Remove-Item Env:\TABA2_PRODUCTION_SALE_E2E
```

Cierra el circuito entero —recepción, publicación, compra, Panel, repartidor,
PIN, entrega, stock N−1 y persistencia— sin que nadie opere una pantalla.

### Por qué NO se creó un pedido real en este sprint

Tres razones, y la primera alcanza:

1. **No se puede completar.** Sin el teléfono, el pedido nace y se queda trabado
   exactamente como LT-0001 y LT-0002. La consigna pedía crear uno «sin
   contaminar producción»; uno que no se puede cerrar la contamina.
2. **Ocuparía el último lugar del repartidor.** Ya lleva 2 de 3. Un tercero lo
   deja en 3 de 3 y **el viernes no podría tomar ningún pedido real**.
3. El producto autorizado (`coca-cola-original-pet-1500ml`) tiene stock 5 y está
   publicado, así que no hace falta atestar stock físico: el caso es
   `CASO_3_VENTA`. Cuando el teléfono esté, la corrida arranca sin ningún dato
   humano más.

### Un error del navegador no le llega a nadie

La tienda tiene una buena **red de rescate** en el arranque: `startup-recovery.js`
escucha `error` en fase de captura —un módulo que no baja no burbujea—, escucha
`unhandledrejection`, y a los 8 segundos sin pintar muestra igual una salida
(«No pudimos abrir la tienda… tu pedido no se perdió»). Medido: con el shell
roto, el cliente ve esa pantalla y no un código interno.

Lo que **no** existe es reporte: un error de JavaScript **después** del arranque
—en el carrito, en el checkout— no viaja a ningún lado. La vigilancia del
servidor ve pedidos que existen; un pedido que nunca se creó porque la pantalla
falló es invisible.

Es una limitación real y se declara en vez de taparla. Montar telemetría es un
sistema nuevo y no es lo que se construye la semana que abre la tienda. La
mitigación de este fin de semana es humana: mirar el Panel, y que el comercio
tenga un canal para que un cliente pueda avisar —que es la decisión 4—.

### Despliegue automático — riesgo operativo declarado

El repositorio **sigue sin ningún secreto de Actions**: faltan
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` y `SUPABASE_PUBLISHABLE_KEY`. La
ruta automática de `deploy-production.yml` **no funciona**; se publica con los
mismos guiones del pipeline desde una máquina con sesión OAuth de Cloudflare
(`pages:write` confirmado). Mientras siga así, **main y producción pueden
desacoplarse con sólo no correr ese comando** — que es el defecto que ese
workflow existe para cerrar.

---

## 6 · Cambios comerciales aplicados a datos

**Ninguno.**

- precios: sin tocar
- stock: sin tocar (856 unidades, igual que al empezar)
- `available` / `sort_order` / `tags`: sin tocar
- horarios, envío, mínimo, zonas, medios de pago: sin tocar
- LT-0001 y LT-0002: **sólo lectura**

Lo único que se escribió en producción es un **cliente de prueba anónimo** con
su perfil y su dirección, que es el mecanismo previsto del arnés
(`--aprovisionar`) y no toca ningún dato del comercio.
