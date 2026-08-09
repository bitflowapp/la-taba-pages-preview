# TABA2 frente a 100 clientes — qué se midió, qué cambió y qué falta

Este documento no declara una transformación. Mide una, dice cuánto de ella se
logró, y deja escrito con números por qué el resto no entró.

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
| `js/back-office.js` | el panel del negocio entra recién cuando hace falta |
| `js/customer-delivery.js` | avisar cuando las direcciones terminan de llegar |
| `js/repositories/supabase_order_repository.js` | decir «se agotó» cuando se agotó |
| `js/ui.js` | que un chip de categoría nunca muestre un slug |
| `scripts/run-100-user-load-drill.mjs` | la prueba de 100 sesiones, que no existía |
| `tests/order-error-messages.test.mjs` | red del mensaje de rechazo |
| `tests/category-labels.test.mjs` | red del nombre de categoría |

---

## 5. El «después»

### Rendimiento — A/B, 5 corridas, mediana

| | antes | después | |
|---|---:|---:|---|
| módulos | 128 | 124 | −4 |
| JavaScript | 2.026 KB | 1.889 KB | **−137 KB** |
| FCP | 1.472 ms | 1.480 ms | +8 ms (ruido) |
| LCP | 6.228 ms | 5.896 ms | **−332 ms (−5%)** |
| bloqueo de hilo | 757 ms | 772 ms | +15 ms (ruido) |
| **1er producto comprable** | **6.774 ms** | **6.474 ms** | **−300 ms (−4%)** |

Es real y es medible. **No es una transformación**: 6,5 segundos hasta ver algo
comprable sigue siendo malo. El porqué está en §7.

### Dos defectos que la medición encontró

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
contra el diccionario de categorías que la aplicación ya tiene —y ahí
«energeticas» resulta ser una categoría conocida, así que el chip pasa a leer
**«Energéticas»**, bien escrita—. Si el id no está en el diccionario, se separan
los guiones y se capitaliza, y nada más: «sidras-artesanales» queda «Sidras
artesanales». **No se inventa ortografía**, porque cómo se llama una categoría
lo decide el negocio y no el storefront.

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

**Los 421 KB restantes del back office.** Diferir los cuatro módulos —panel,
reparto, producción y sandbox— llevaba el ahorro a **556 KB y 38 módulos menos**,
cuatro veces lo logrado. Está medido y funciona: el cliente baja 89 módulos y
1.432 KB.

No se pudo sostener. El modo demo depende de que ese grafo esté descargado y
evaluado temprano, y al diferirlo empezaron a fallar de forma reproducible tres
pruebas de extremo a extremo: el orden de la góndola, la búsqueda con puntuación
local y la dirección del encabezado.

Se probaron tres variantes —cargar al primer render, esperar dentro de
`bootstrap()`, y esperar en el nivel superior del módulo para que termine de
evaluarse antes que `app.js`—. Las tres arreglan el **orden** y ninguna arregla
la última prueba, porque lo que queda no es orden sino **latencia**: el import
dinámico agrega una vuelta de red antes de que arranque la app, y la hidratación
de direcciones llega tarde a la primera lectura.

La salida no es esconder módulos detrás de una compuerta en runtime: es **separar
el documento de la demo del documento del cliente**, para que el cliente cargue
un grafo que nunca tuvo esos módulos. Eso es un cambio de estructura, no un
parche, y no entra en el mismo encargo en que se toca el resto.

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

- Los 421 KB + 170 KB de §7.
- El smoke físico en el Moto G15: su lock estuvo ajeno y activo todo el encargo.
  No se desplazó.
- `products.price` sigue siendo `not null`, con el 0 haciendo de «sin precio».
  Documentado en `CONTRATO-PRECIO-STOCK.md`.
- La carrera de `business-windows-operations.spec.mjs`, heredada.
- El techo de 100 conexiones de PostgreSQL.
