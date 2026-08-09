# TABA2 frente a 100 clientes — qué se midió, qué cambió y qué falta

Todo lo que sigue está medido, no estimado. El resumen en una línea: un cliente
deja de descargar el 28% del JavaScript y ve algo que puede comprar 1,4 segundos
antes; el backend demostró que aguanta 100 personas comprando a la vez; y
aparecieron cinco defectos reales que sólo se ven mirando.

---

## 1. Cómo se midió

Todo lo de acá se midió, nada se estimó.

- **Rendimiento**: Chromium con perfil de iPhone 13, red móvil emulada (4 Mbps,
  40 ms) y CPU a ¼ —un teléfono de gama baja, no esta máquina—. Cinco corridas
  por lado, se reporta la **mediana**: una sola corrida tiene ruido suficiente
  para contar cualquier historia.
- **A/B en el mismo entorno**: el «antes» (`da56ce9`, exactamente lo que hoy
  sirve staging) y el «después» servidos por el mismo servidor local, en el
  mismo host, con el mismo navegador. Comparar contra la URL pública habría
  mezclado la latencia del CDN con el cambio.
- **Carga**: base PostgreSQL efímera y propia, cadena de migraciones real, RPC
  real de compra. Cada sesión es una conexión de verdad. No se tocó staging, no
  se contaminó ningún dato humano, no se movió un peso.

La métrica que manda no es «cuánto pesa» sino **cuánto tarda una persona en ver
algo que puede comprar**. Es la que decide si se queda o se va.

---

## 2. El «antes»

### Lo que se descarga para comprar una lata

| grupo | archivos | peso |
|---|---:|---:|
| cliente | 89 | 1.023 KB |
| **panel del negocio** | 26 | **414 KB** |
| vendor (supabase) | 1 | 207 KB |
| **operación / Rider** | 6 | **175 KB** |
| **datos pendientes** | 1 | **113 KB** |
| **datos demo** | 4 | **57 KB** |
| **total** | **127** | **1.988 KB** |

**759 KB —el 38%— es back office.** Un cliente descargaba, parseaba y ejecutaba
el panel con el que se atiende el local, el centro de operaciones y las
herramientas de sandbox antes de poder ver la góndola. Nada de eso se le
renderizaba nunca: ya estaba detrás de `isDemoMode()`. Se pagaba el costo
completo por código que no se usaba.

### Lo que tarda

Contra la URL pública, primera visita:

| escenario | LCP | 1er producto comprable |
|---|---:|---:|
| 4G, caché fría | 3.056 ms | 3.378 ms |
| red lenta, caché fría | 15.944 ms | **16.625 ms** |
| segunda visita (SW tibio) | 996 ms | 1.197 ms |

La segunda visita está bien. La primera —la de las 100 personas que nunca vieron
TABA2— tarda **16,6 segundos en red mala**.

### Lo que hay para vender

Del medidor del propio repositorio: 81 productos de góndola, **0 listos para
publicar**, 70 sin precio, 0 con stock cargado. En staging hay 8 comprables.
Eso no es software y no se toca acá: está en `ONBOARDING-CATALOGO.md`.

---

## 3. Los cuellos, por tamaño

1. **La primera pantalla descarga toda la aplicación** — 759 KB de back office.
   **Resuelto**: −562 KB y −38 módulos (§5).
2. **La cadena de datos demo** — 170 KB (`taba2-commercial-pending-data.js` +
   `approved-beverage-demo-data.js`) que el cliente arrastra sólo porque
   `ui.js` y `state.js` piden `categories` a un barril que reexporta el catálogo
   entero. `authorityCategories` pesa 0,8 KB; `pendingProducts`, 111,4 KB.
3. **El chip «Enviar a» no se enteraba de las direcciones** (corregido, §5).
4. **El rechazo por agotado no se entendía** (corregido, §5).
5. **Un chip de categoría mostraba un slug** (corregido, §5).
6. El catálogo sin precios ni stock — de Walter, §8.

---

## 4. Qué cambió

| commit | qué |
|---|---|
| `js/back-office.js` | el back office entero entra recién cuando hace falta |
| `js/customer-delivery.js` | avisar cuando las direcciones terminan de llegar |
| `js/repositories/supabase_order_repository.js` | decir «se agotó» cuando se agotó |
| `js/ui.js` | el chip de categoría no muestra slugs; el de dirección no miente |
| `scripts/run-100-user-load-drill.mjs` | la prueba de 100 sesiones, que no existía |
| `tests/order-error-messages.test.mjs` | red del mensaje de rechazo |
| `tests/category-labels.test.mjs` | red del nombre de categoría |

---

## 5. El «después»

### Rendimiento — A/B, 5 corridas, mediana

| | antes | después | |
|---|---:|---:|---|
| módulos | 128 | **90** | **−38** |
| JavaScript | 2.026 KB | **1.464 KB** | **−562 KB (−28%)** |
| FCP | 1.496 ms | 1.452 ms | −3% |
| LCP | 6.156 ms | **4.784 ms** | **−1.372 ms (−22%)** |
| bloqueo de hilo | 482 ms | **365 ms** | **−24%** |
| **1er producto comprable** | **6.868 ms** | **5.470 ms** | **−1.398 ms (−20%)** |

Un cliente deja de descargar **el 28% del JavaScript** y ve algo que puede
comprar **1,4 segundos antes**.

### La trampa que casi me hace declarar esto imposible

El primer intento de diferir los cuatro módulos rompió pruebas de extremo a
extremo que no tenían nada que ver entre sí: el orden de la góndola, la búsqueda
con puntuación local, la dirección del encabezado, el scroll fantasma, el
sandbox. Pasé por tres teorías equivocadas —orden de evaluación del grafo,
momento del arranque, latencia del import dinámico—, probé tres variantes,
acoté el alcance a un cuarto del ahorro y **lo documenté como imposible**.

La causa era mucho más tonta y estaba en mi propio código. Con el módulo sin
cargar, los envoltorios devolvían `undefined`. Pero `app.js` hace
`if (resultado.handled) return;` sin guardia, así que `undefined` **no era un
no-op: era un TypeError** que abortaba el manejador de eventos entero y se
llevaba puesto todo lo que venía después. Escribías en el buscador y la góndola
no filtraba, sin un solo error visible en pantalla.

Ahora cada handler devuelve `{ handled: false }`, que es exactamente lo que
devuelve el módulo real cuando el evento no le corresponde —y es literalmente
cierto: su pantalla no está en el documento—.

La lección quedó escrita en `js/back-office.js`: **un no-op tiene que respetar la
forma del contrato, no sólo existir**. Y tres teorías plausibles seguidas no
valen una medición.

### Los defectos que la medición encontró

**El encabezado mentía sobre a dónde va el pedido.** Las direcciones del cliente
llegan del backend *después* del primer pintado. Cuando llegaban, nadie se lo
decía al chip «Enviar a»: el aviso existía, pero sólo salía desde el checkout,
una pantalla más adelante. Resultado: la home decía «Elegí tu dirección» aunque
la persona tuviera una predeterminada confirmada, hasta que algo más provocara
un re-render. Ahora se avisa al hidratar, que es cuando el dato aparece.

**Un chip de categoría mostraba un slug.** En staging, 2 de 12 productos llegan
con `category_name` igual al id, así que la primera pantalla decía
«energeticas» —en minúscula y sin acento— al lado de «Cervezas» y «Gaseosas».
El dato lo arregla el negocio, pero la góndola no puede mostrar un slug crudo
mientras tanto: el día que se carguen categorías nuevas vuelve a pasar, y es lo
primero que ve una persona. Ahora, si el nombre viene igual al id, se resuelve
contra el diccionario de categorías que la aplicación ya tiene; si el id no está
ahí, se separan los guiones y se capitaliza, y nada más.

Verificado en el navegador contra el catálogo real: el chip pasa de
«energeticas» a **«Energeticas»** —legible, capitalizado, **sin acento**—, y
«sidras-artesanales» quedaría «Sidras artesanales». El acento no se agrega
porque `energeticas` no está en el diccionario de la aplicación —que conoce
`energizantes`— y ponérselo sería escribir por el negocio. Si el id sí está en
el diccionario, gana el nombre del diccionario con su ortografía correcta.

La categoría se sigue llamando bien el día que Walter la cargue con su nombre
real: esto es una red, no un reemplazo del dato.

**El rechazo por agotado invitaba a reintentar para siempre.** Cuando el stock
llega a cero, el contrato comercial apaga la disponibilidad y la RPC responde
`producto no disponible: <uuid>`. El traductor de errores del cliente sólo
buscaba `stock` y `available` —en inglés—, así que ese rechazo caía en el
genérico: «No pudimos confirmar el pedido. Conservamos el intento para
reintentar sin duplicarlo». Es decir: invitaba a reintentar una compra que nunca
iba a entrar, sin decir que el producto se había agotado.

Este defecto lo encontró la prueba de carga: es el mensaje que recibieron **60
de las 100 personas** que llegaron tarde. Con una sesión por vez no aparece.

---

## 6. Cien personas comprando a la vez

Base efímera propia, RPC real, 100 conexiones reales, hasta 40 simultáneas.

### A · más gente que stock — 100 personas, 40 unidades

```
40 compraron · 60 rechazadas · stock 40 → 0 · unidades vendidas 40
```

- nunca se vendió más stock del que había
- el stock nunca quedó negativo
- lo vendido y lo descontado coinciden exactamente
- un pedido por persona que compró

### B · doble click — 40 personas tocando «Confirmar» dos veces a la vez

```
80 envíos → 40 pedidos → 40 unidades
```

La idempotencia por `client_request_id` aguanta la concurrencia real: el índice
único y el `for update` hacen que el segundo envío devuelva el mismo pedido en
vez de crear otro.

### C · mezcla realista — 100 sesiones sobre catálogo mixto

Dos corridas, con el host en condiciones distintas:

| | pedidos/s | p50 | p95 | máx |
|---|---:|---:|---:|---:|
| host libre | 22,3 | 1.489 ms | 2.297 ms | 3.039 ms |
| host con Playwright en paralelo | 4,4 | 6.635 ms | 15.501 ms | 15.712 ms |

Las dos completaron **100/100 sin un solo error y sin un solo duplicado**, que es
lo que la prueba viene a demostrar.

Los números de latencia **no son la capacidad de la base**: cada sesión arranca
un proceso `psql` propio (~1 s de por sí) y el factor 5 entre las dos corridas
es contención del host, no de PostgreSQL. Sirven como piso y como comparación
entre corridas, no como cifra absoluta. Lo que sí es absoluto es que la
integridad se sostuvo en las dos.

### Integridad, después de 240 intentos de compra concurrentes

- ningún producto con stock negativo
- ningún ítem huérfano de su pedido
- ningún pedido sin ítems (ninguna venta ambigua)
- ningún `client_request_id` con dos pedidos

**El backend aguanta.** Lo que no aguanta es la primera pantalla.

### Un techo que conviene saber

La imagen de PostgreSQL trae `max_connections = 100`. Con PostgREST de por medio
no es uno a uno, pero es el número a mirar el día que el piloto crezca.

### Lo que rompí en el camino, y cómo apareció

Refactorizar el arranque tuvo costo, y conviene que quede escrito:

- **Cinco specs rotos por dejar un objeto en `null`.** Al acotar el alcance a
  diferir sólo el panel, dejé los envoltorios de reparto, producción y sandbox
  leyendo el objeto que sólo se llena cuando el panel entra. Resultado: esas
  tres superficies quedaban mudas para cualquiera que no abriera el negocio.
  Lo encontró la suite completa —`ios-phantom-scroll`, `operational-hardening`
  y `sandbox-flow`—, no yo.
- **Comentarios que quedaron mintiendo** sobre el alcance después de acotarlo.
- **Una prueba propia frágil**: fijaba «Energeticas» sin acento y pasaba
  aislada, pero fallaba en la suite completa, porque qué diccionario de
  categorías está cargado depende de si otra prueba instaló antes un catálogo de
  test. Reescrita contra el contrato en vez de contra una cadena.

Ninguno llegó a un commit sin corregir, pero los tres salieron de correr las
suites enteras y no de mirar el diff. Es el argumento a favor de correrlas.

---

## 7. Lo que no entró, y por qué

**Los 170 KB de datos demo.** `ui.js` y `state.js` importan `categories` de un
barril que reexporta el catálogo entero. Separar `authorityCategories` (0,8 KB)
de `pendingProducts` (111,4 KB) requiere tocar `scripts/taba2-catalog-authority.mjs`
—que sí está en el repo— y `approved-beverage-demo-data.js`, cuyo generador
(`scripts/import-approved-beverages.mjs`) **no está en el repo**. Editar a mano
un archivo que se declara generado, sin el generador que lo mantiene, deja una
trampa para la próxima regeneración. Queda anotado, no hecho.

---

## 8. Lo único que depende de Walter

Nada de esto es software:

1. **Precio de 70 SKU.** Hoy 0 productos de góndola están listos para publicar.
2. **Stock.** 0 de 81 tienen unidades cargadas.
3. **Derechos de las 71 fotos.** Están en disco y se publican igual; la decisión
   comercial de acreditarlas está pendiente.
4. **Vigencia de las promociones.**
5. **El área de reparto**, que todavía no está publicada.
6. **Confirmar el punto del local**: sigue con `human_verified: false`.

La planilla que hay que completar y el importador seguro ya están hechos:
`ONBOARDING-CATALOGO.md`.

---

## 9. Deuda que este encargo no cierra

- **El chip `+18` de la góndola está blanco y colgado del nodo equivocado.**
  La auditoría visual lo marca en 12 pantallas (`[superficie clara]
  span.product-age-tag bg=rgba(255,255,255,0.92)`) sobre una identidad negra.
  Es **preexistente** —está igual en `da56ce9`— y tiene dos causas concretas:
  1. En el inicio el chip va DENTRO de `.home-best-media`, así que la auditoría
     lo trata como parte del plato del packshot y no lo marca. En la góndola va
     como hermano de `.product-media`, fuera del plato, y sí lo marca.
  2. El comentario del propio código dice que el chip «tiene que decir en
     dorado —el mismo lenguaje que el chip de los combos—», pero el CSS lo pinta
     `rgb(255 255 255 / 92%)` con texto marrón.

  No se tocó acá a propósito: el chip va encima de una foto de producto, así que
  el blanco puede ser lo que lo hace legible sobre cualquier packshot, y eso hay
  que verlo con los ojos antes de cambiarlo. Cambiar un color de legibilidad sin
  poder mirarlo es exactamente el tipo de arreglo que queda prolijo en el diff y
  peor en pantalla.

- Los 170 KB de datos demo de §7.
- El smoke físico en el Moto G15: su lock estuvo ajeno y activo todo el encargo.
  No se desplazó.
- `products.price` sigue siendo `not null`, con el 0 haciendo de «sin precio».
  Documentado en `CONTRATO-PRECIO-STOCK.md`.
- La carrera de `business-windows-operations.spec.mjs`, heredada.
- El techo de 100 conexiones de PostgreSQL.
