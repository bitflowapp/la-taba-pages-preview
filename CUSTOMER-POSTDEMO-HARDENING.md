# TABA2 — Endurecimiento del Cliente después de la demo

Rama: `fix/taba2-customer-postdemo-hardening` · base congelada `bc9af92`
Worktree: `…\1212\worktrees\taba2-customer-postdemo`

**`release/taba2-commercial-rc` no se tocó.** Nada de lo de acá está integrado ni
publicado. La demo de Walter sigue ejecutando exactamente la RC congelada.

---

## 1. Chrome en iPhone — estado congelado

### Primero: ¿el servidor devuelve bien el snapshot?

Sí, y esto es lo que ordena todo lo demás.

`get_public_order_tracking` (definición viva: `20260813030000`) devuelve en UNA
llamada el estado autoritativo completo: `status`, `revision`, `created_at`,
`accepted_at`, `preparing_at`, `ready_at`, `dispatched_at`, `arrived_at`,
`delivered_at`, `terminal_visible_until`, el ETA confiable y el último fix del
rider dentro de la ventana de 3 minutos.

O sea: **cualquier consulta exitosa converge al cliente al estado correcto, sin
importar cuántos eventos intermedios se perdió.** El servidor nunca fue el
problema. El problema era que el cliente dejaba de preguntar.

### La causa raíz

`js/app.js` apagaba el seguimiento del cliente en un evento de la familia
`pagehide` y lo volvía a encender ÚNICAMENTE con `pageshow`:

```js
window.addEventListener('pagehide', () => {
  …
  syncCustomerTrackingWithView('');        // ← destruye la sesión de seguimiento
});
window.addEventListener('pageshow', () => syncCustomerTrackingWithView(activeView));
```

`syncCustomerTrackingWithView('')` no pausa: llama a
`setCustomerTrackingView({ active: false })` → `customerTrackingPoll.stop()`, que
además de cortar timers y abortar la consulta en vuelo ejecuta
`unbindLifecycle()` — **desarma los propios listeners de reanudación del
controlador** (`visibilitychange`, `focus`, `pageshow`, `online`).

Después de eso el controlador queda completamente inerte. Lo único que podía
revivirlo era `pageshow`, o un `renderAll()`, que sólo ocurre cuando cambia el
estado… y lo que traía los cambios de estado era justamente el seguimiento
apagado. **Se apagaba solo y no se prendía más.**

Esto explica las tres observaciones sin culpar a ningún motor:

| | ¿emite `pagehide` al suspender? | ¿emite `pageshow` al volver? | resultado |
|---|---|---|---|
| Android + Chrome | no (cambiar de app sólo dispara `visibilitychange`) | — | **anda**: el controlador nunca se destruye y su propio `visibilitychange` lo reanuda |
| iPhone + Safari | sí (entra a la caché de retroceso) | sí | **anda**: `pageshow` lo rearma |
| iPhone + Chrome | sí | **no** (no restaura desde la caché de retroceso: sigue con la misma página viva) | **se congela** |

El defecto es de FORMA, no de navegador: **la app desarmaba con un evento y
rearmaba con otro distinto.** Cualquier navegador cuyo par suspender/reanudar no
sea simétrico en esos dos eventos queda colgado. Chrome en iPhone es el que hoy
cae del lado malo.

### El segundo agujero, independiente del primero

`createRealtimeWatch` no tenía NINGÚN listener de ciclo de vida, y al recibir
`SUBSCRIBED` apagaba el polling de respaldo sin hacer una consulta de puesta al
día. `postgres_changes` no tiene replay: reconectar recupera el caudal de eventos
futuros, no los que ocurrieron durante el corte. Un teléfono suspendido no
recibe eventos ni corre timers, y al volver el socket se reconecta y vuelve a
decir `SUBSCRIBED` como si nada hubiera pasado.

### El fix

1. **`js/core/browser-resume.js` (nuevo).** Un único lugar que sabe que «volvió»
   se anuncia con cinco señales distintas y que ningún navegador emite todas:
   `pageshow`, `focus`, `online` (window), `visibilitychange`→visible y `resume`
   (document). Se escuchan TODAS y manda la primera que llegue. Borde de ataque:
   reconcilia ya, sin debounce; las que la acompañan (iOS despacha tres casi
   juntas) quedan absorbidas por una ventana de fusión de 250 ms.

2. **`js/app.js`.** `pagehide` ya no apaga el seguimiento del cliente — el
   controlador ya sabía estar en segundo plano por su cuenta (con el documento
   oculto aborta la consulta en vuelo y deja de consultar; no hacía falta
   destruirlo). La restauración pasa a `onBrowserResume(...)`. El corte del GPS
   del rider en `pagehide` se conserva intacto.

3. **`js/repositories/supabase_order_repository.js`.** `createRealtimeWatch`
   reconcilia contra el servidor en cada vuelta del navegador, con independencia
   de la salud del canal; y una suscripción que YA estuvo caída hace una consulta
   de puesta al día al volver a `SUBSCRIBED`.

4. **Puesta al día con single-flight.** Los tres disparadores (arranque, caída del
   canal, vuelta del navegador) llegan juntos en el arranque. El que llega
   mientras ya hay otro en vuelo se cuelga de ese en vez de abrir otro — no es un
   debounce: nadie espera y nadie se pierde el dato.

5. **Un solo dueño por pedido.** Mientras el cliente está en «Seguir», el
   controlador tokenizado tiene la sesión de ese pedido y escucha por su cuenta
   las mismas señales; el sync global ya no vuelve a preguntar por ese mismo
   pedido. Sobre un pedido entregado eso importa de verdad: la revalidación de la
   ventana terminal es deliberadamente única y dos solicitantes la convertían en
   dos. **Lo detectó `tracking-terminal-expiry.spec.mjs`** contra una primera
   versión de este fix; se corrigió el fix, no la prueba.

---

## 2. Restauración autoritativa

El Cliente converge al estado del servidor en `load`, `reload`, `focus`,
`pageshow`, `visibilitychange`→visible, `online`, `resume` y después de un
segundo plano prolongado, **sin depender de haber recibido los eventos
intermedios**.

Cubierto por prueba: un pedido que pasa `accepted → preparing → on_the_way`
mientras la pestaña duerme y sin un solo evento realtime muestra `on_the_way` al
volver — con el intervalo de polling puesto en 600 s para que la convergencia no
pueda venir de otro lado.

---

## 3. Tracking / mapa

El marcador converge de A a B cuando el DTO trae una posición más reciente. Lo
que fallaba no era la convergencia del marcador: era que el snapshot no llegaba.
Con el snapshot llegando, `shouldRenderGpsFix` (≥6 m o ≥1,2 s) deja pasar
cualquier movimiento real, y tras un segundo plano la marca de render vieja
garantiza el repintado.

Se preservan sin cambios: `location_quality` tal como la declara el servidor
(**no se vuelve a inferir sobre la accuracy pública**, que lleva piso de 100 m
por privacidad — F26/F36), el piso de privacidad, F25, la ventana terminal y la
purga en `delivered`.

---

## 4. Ubicación / dirección entre navegadores

### Dónde vive hoy cada cosa

**A — Sesión efímera (memoria / `sessionStorage`, muere con la pestaña)**

| dato | dónde |
|---|---|
| `addresses[]`, `selectedAddressId`, `addressesKnown` | memoria de `js/customer-delivery.js`, rehidratado del servidor en cada carga |
| Borrador de confirmación del punto (`empty`/`pending`/`confirmed`) | memoria, `js/core/delivery-location-draft.js` |
| Acceso de seguimiento (`orderId`, `publicCode`, `trackingToken`) | `sessionStorage` — `supabase_order_repository.js:97` |
| `taba:profile-return`, `adminUnlocked` | `sessionStorage` |

**B — Persistente por navegador (`localStorage`; sobrevive a la recarga, NO se
comparte entre navegadores)**

| dato | dónde |
|---|---|
| **Sesión de autenticación (token anónimo)** | `supabase-client.js:52` — **esto es la identidad** |
| Estado de la app, carrito productivo | `la_taba_mvp_v4_state`, `la_taba_production_cart_v1` |
| Espejo local de nombre/teléfono, favoritos, historial | `la_taba_customer_profile_v1`, … |
| Clave de idempotencia del pedido | `durableStorage` |

**C — Servidor, por cuenta — YA EXISTE Y YA SE USA**

`public.customers` (`id` → `auth.users(id)`) y `public.customer_addresses`
guardan calle, número, piso, departamento, referencia, barrio/ciudad, provincia,
código postal, **latitud/longitud**, precisión, origen y `isDefault`. Se escriben
y se leen con `get_current_customer_profile`,
`upsert_current_customer_profile` y `upsert_current_customer_address`, desde
`js/repositories/customer_profile_repository.js`.

### Entonces: ¿bug o aislamiento normal?

**Ninguna de las dos, exactamente.** La dirección **ya está en el servidor**. No
es un dato que viva sólo en el navegador, y no hay infraestructura sin usar que
haya que cablear: el checkout y el perfil ya guardan y ya hidratan (cubierto por
`customer-delivery-address-hydration.test.mjs`).

Lo que no viaja entre navegadores es la **identidad**. La sesión es un usuario
**anónimo** de Supabase cuyo refresh token vive en el `localStorage` de cada
navegador. Safari y Chrome en el mismo iPhone son orígenes de almacenamiento
distintos → cada uno acuña un `auth.uid()` distinto → `customer_addresses` está
correctamente asociada… a dos cuentas distintas.

### La pregunta de producto

> ¿La dirección pertenece al dispositivo/navegador o al cliente?

Pertenece al cliente, y el modelo de datos ya lo dice así. **Hoy la cuenta ES el
navegador**, porque la única identidad que hay es anónima y local. Para que la
dirección siga a la persona hace falta una **identidad portable**: teléfono con
OTP, enlace por email, o vincular el usuario anónimo existente a una credencial.

**No requiere contrato nuevo de DB, y por lo tanto no se dispara el STOP.**
`customers.id` ya referencia `auth.users(id)`, y vincular una credencial a un
usuario anónimo **conserva el mismo uid**: las direcciones ya guardadas
sobreviven a la vinculación. Es una decisión de autenticación y de producto —con
su propio costo en UX y en abuso—, no una migración. **No se implementó nada acá:
excede «fijar el wiring con tests» y es una decisión que no me corresponde
tomar.**

---

## 5. Foto de producto / «Reservar» — NO REPRODUCIDO

`Reservar` **no existe en el código, en ninguna revisión, ni en el build
publicado.**

- `git log --all -S` (pickaxe) sobre las **739 revisiones alcanzables**: cero
  commits que agreguen o quiten `Reservar` o `Reservá`. `git grep` de esos
  rótulos sobre cada una de las 739 revisiones, en `js/**` e `index.html`: cero
  archivos. En el árbol actual sólo aparece «reserva de stock» (dominio de
  inventario), `preservar`, y el nombre comercial del producto **Trapiche
  Reserva Malbec**.
- El bundle servido por `taba2-staging.pages.dev/js/ui.js` (verificado por
  lectura, sin tocar nada) coincide con HEAD: el rótulo es `Agregar`.

El vocabulario real al tocar la foto de un producto (`data-product-detail` → ficha):

| control | rótulo |
|---|---|
| acción de compra (grilla y ficha) | **Agregar** / `Precio pendiente` / `No disponible` |
| acción secundaria de la ficha | **Guardar para después** / `Guardado` |
| historias | `Agregar al carrito`, `Ver producto`, `Ver oferta` |
| repetir pedido | `Agregar de nuevo` |

**No se cambió nada.** Cambiar un copy correcto sobre una conjetura sería peor
que dejarlo. Los dos candidatos a lo que se vio son: (a) **«Guardar para
después»**, que es el botón secundario que aparece pegado a la foto en la ficha y
que en un delivery se puede leer como «reservar» —aunque la acción real es
guardar, no reservar, así que el rótulo es correcto—, o (b) el nombre del
producto **Trapiche Reserva Malbec**. **Hace falta una captura o el nombre exacto
de la pantalla para cerrarlo.**

---

## 6. Tests

Nuevos (18):

- `tests/browser-resume-lifecycle.test.mjs` (5) — cada señal reanuda; ocultarse
  no reanuda; una ráfaga reconcilia una sola vez y de inmediato; desarmar quita
  todos los listeners.
- `tests/customer-resume-restore-contract.test.mjs` (7) — `pagehide` no apaga el
  seguimiento; la restauración escucha todas las señales; la reconciliación no
  depende del canal; las puestas al día concurrentes se cuelgan de la que está en
  vuelo; un solo dueño por pedido; el controlador conserva sus señales;
  el módulo nuevo entra al precache.
- `tests/supabase-repository.test.mjs` (6 agregados) — convergencia desde
  segundo plano sin eventos intermedios; `visibilitychange` reanuda igual que
  `pageshow`; recuperación al re-suscribirse; consulta inmediata al perder el
  canal; **marcador A→B conservando `location_quality` y el piso de privacidad**;
  desmontar desarma los listeners.

Todos escritos en rojo antes del fix (verificado: 7 fallaban por módulo
inexistente y 6 por comportamiento ausente).

Ninguna prueba existente fue modificada para acomodar el cambio. La única
modificada es una aserción **mía**, actualizada cuando el propio fix mejoró
(single-flight); su garantía de comportamiento sigue cubierta por las pruebas de
repositorio y por el e2e.
