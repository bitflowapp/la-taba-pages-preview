# TABA v2 — Decisiones

## 0 · Nota sobre el alcance de esta sesión

**El texto del encargo llegó truncado.** Termina en el árbol de directorios y no incluye la lista explícita de "puntos no aprobados de la v1". No se detuvo el trabajo por eso: se derivó el alcance focal de forma rigurosa a partir de dos fuentes objetivas.

**Fuente 1 — lo que el encargo aprueba, literalmente.** Dos entradas están acotadas a propósito:
- *"**arquitectura** master-detail del negocio desktop"* — se aprueba la arquitectura, no su ejecución.
- *"**arquitectura conceptual** del rider Android"* — ídem.

**Fuente 2 — lo que la v1 dejó abierto.** El `README.md` de la v1 cierra con "Qué necesita decisión humana", y la auditoría dejó defectos medidos sin resolver.

De ahí salen cuatro focos. Si esta lectura no coincide con la tuya, el trabajo está aislado en `2026-07-31-v2/` y los tokens no se tocaron: revertir un foco no arrastra a los demás.

| # | Foco | Por qué entra |
|---|---|---|
| **F1** | Flujo de compra: carrito y checkout | La v1 **nunca lo prototipó**. La nav promete "Ver pedido" y no había pantalla. Y es donde aterriza el cambio de mayor riesgo comercial: `.checkout-form .button-row` depende de la reserva de P0-01, y la v1 no lo validó con teclado abierto |
| **F2** | Negocio desktop en tablet | Hueco funcional real: la spec decía "el detalle pasa a hoja lateral" y el prototipo lo **ocultaba**. A 768px no se podía abrir un pedido |
| **F3** | Rider: ejecución visual | Faltaban 5 de los 25 flujos especificados y el mapa era una trama de papel cuadriculado |
| **F4** | Defectos medidos pendientes | Presentación en 2 líneas que desalineaba precios; "Speed Unlimited" duplicado; tarjeta de 320px poco ejercitada |

**Fuera de alcance deliberado:** todo lo aprobado. No se rediseñó nada, no se regeneraron los 118 artefactos y **los tokens tienen cero diff contra la v1**.

---

## 1 · Checkout de una sola página, no un asistente por pasos

**Decisión:** cinco secciones numeradas en una página con scroll, no cinco pantallas encadenadas.

**Por qué:** el pedido tiene 4 decisiones (modalidad, dirección, contacto, pago) y ninguna depende de la anterior salvo dirección↔modalidad. Un asistente añade 4 transiciones y 4 oportunidades de abandono para ahorrar scroll que el usuario hace igual. Además el total permanece visible en la barra de acción durante todo el recorrido, que es la información que más se consulta antes de confirmar.

**Consecuencia para implementación:** una sola vista, un solo estado de formulario, validación en línea por campo.

## 2 · La dirección viene del Perfil, no de un formulario en blanco

**Decisión:** las direcciones guardadas se presentan como opciones seleccionables (`role="radio"`), con "Usar otra dirección" como salida. Sin direcciones guardadas, la sección se convierte en un llamado a agregar una desde Perfil.

**Por qué:** el árbol tiene trabajo en curso exactamente sobre esto (`js/core/profile-checkout.js`, `js/repositories/sandbox_customer_profile_repository.js`, "checkout basado en Perfil", "direcciones guardadas"). El diseño se alinea con esa arquitectura en lugar de proponer una alternativa que obligaría a rehacerla.

## 3 · El vuelto se calcula y se muestra al cliente

**Decisión:** con pago en efectivo, el campo "¿Con cuánto abonás?" calcula y muestra el vuelto en vivo; si el importe no alcanza, lo dice.

**Por qué:** el dato ya existe aguas abajo — el detalle del negocio de la v1 muestra "Efectivo · abona con $ 50.000 · vuelto $ 7.700" y el rider lo ve en "Cobrar al entregar". Capturarlo en el checkout evita que el local lo deduzca y que el rider llegue sin cambio. Es opcional: no bloquea la compra.

## 4 · Carrito y checkout son pantallas apiladas, sin navegación inferior

**Decisión:** en ambas se retira la bottom nav y la reserva inferior pasa a ser la altura **real** de la barra de acción, medida en tiempo de ejecución:

```js
const h = act.hidden ? 0 : act.getBoundingClientRect().height;
document.body.style.setProperty("--action-h", h + "px");
```

**Por qué:** la barra cambia de altura según el estado (con o sin fila de total). Un literal volvería a introducir el número mágico que causó P0-01. Medir la altura real y alimentar el mismo token derivado mantiene el invariante del sistema.

**Consecuencia:** verificado con teclado abierto (390×420) — **0 nodos tapados**.

## 5 · La hoja de detalle del negocio en tablet es de ancho completo y sin backdrop

**Decisión:** a ≤1023px el detalle entra deslizando desde la derecha ocupando todo el ancho. Se cierra con el botón "Cola de pedidos" y con `Escape`, devolviendo el foco a la tarjeta seleccionada. **No hay backdrop.**

**Por qué:** se probó con backdrop y quedó **íntegramente cubierto por la hoja**, así que no era tocable: un elemento invisible e inservible que sólo añadía una capa. A 768px el detalle del pedido es denso (productos, totales, código, línea de tiempo) y necesita el ancho completo.

**Rechazado:** dejar una franja de la cola visible. A 768px una hoja de 600px deja el detalle apretado sin dar contexto útil.

## 6 · El precio se ancla al pie de la tarjeta

**Decisión:** `.p-body { display: flex; flex-direction: column }` + `.p-foot { margin-top: auto }`.

**Por qué:** presentaciones como "Botella PET · 500 ml · Pack x12" ocupan 1 o 2 líneas según el producto, y el precio quedaba a distinta altura en tarjetas contiguas. La alternativa —`min-height` en el título y la presentación— es la que tenía el repositorio actual y es la que infla la tarjeta con contenido corto.

**Se descartó recortar la presentación a una línea:** "Pack x12" es información de compra, no adorno.

## 7 · Productos indistinguibles: se expone la variante que ya existe

**Decisión:** `speed-original-lata-473ml` y `speed-zero-lata-473ml` se muestran como **"Speed Unlimited Original"** y **"Speed Unlimited Zero"**.

**Por qué:** hoy ambos se renderizan como "Speed Unlimited · Lata · 473 ml · Unidad · $ 2.925" y el cliente no puede elegir. La variante **ya está en el identificador del producto**: exponerla es mostrar un dato existente, no inventarlo.

**Requiere confirmación humana:** si el nombre comercial correcto es otro ("Speed Zero", "Speed Sin Azúcar"), lo decide el negocio. La regla técnica es independiente del rótulo: `(nombre, presentación)` debe ser único, y esa validación va al pipeline de catálogo.

Estado `variants` del prototipo: `prototype-catalog-mobile.html?state=variants`.

## 8 · El rider ve qué pasa con lo que ya hizo

**Decisión:** las tres pantallas nuevas de interrupción (`expired`, `cancelled`, `absent`) dedican un bloque explícito a **el estado de lo ya registrado**, no sólo a la novedad.

- Sesión expirada → lista las acciones pendientes y dice "se reenvían solas apenas vuelvas a entrar".
- Cancelación → "tenés el pedido encima: devolvelo", "ubicación detenida", "el viaje queda registrado".
- Cliente ausente → temporizador de 5 minutos, tres intentos sugeridos, y "no es una falta tuya: queda auditado".

**Por qué:** el principio de la v1 es "nada se pierde"; si la interfaz no lo dice en el momento de la interrupción, el rider no tiene forma de saberlo y desconfía de la app. La cola durable sólo genera confianza si es **visible**.

## 9 · Cliente ausente es un protocolo, no un botón

**Decisión:** pantalla propia con espera de 5 minutos, contador visible, tres acciones sugeridas antes de cerrar (llamar, verificar dirección, avisar al local) y registro con hora y ubicación.

**Por qué:** es la incidencia más frecuente y la más disputada. Sin protocolo, la decisión queda a criterio del rider bajo presión y sin evidencia. Con protocolo, el resultado es auditable y el rider queda cubierto.

## 10 · El historial del rider no guarda datos del cliente

**Decisión:** el historial del día muestra número de pedido, hora, importe y estado. Nada más, y se dice explícitamente en la pantalla.

**Por qué:** coherencia con la regla de visibilidad limitada de `RIDER_ANDROID_SECURITY.md` — los datos del cliente desaparecen de la proyección al cerrar el pedido. Que la interfaz lo declare convierte una regla de backend en una promesa verificable.

## 11 · El mapa simulado dibuja una ruta

**Decisión:** trama de manzanas en dos densidades, una avenida diagonal, y una **polilínea SVG** de local → posición → cliente, con variante punteada ámbar para GPS obsoleto.

**Por qué:** la trama sola se leía como papel cuadriculado y no permitía evaluar la pantalla de navegación. Con ruta trazada, el prototipo sirve para juzgar jerarquía entre mapa, ETA y acción — que es lo que hay que decidir antes de integrar MapLibre.

**Sigue siendo simulado.** No es un mapa real ni pretende serlo.

---

## Decisiones que siguen requiriendo una persona

1. **Nombre comercial de las variantes Speed** (ver §7).
2. **Prueba física en iPhone y Android reales.** La validación con teclado usa un viewport reducido de 390×420 como proxy; el teclado real y el `safe-area-inset-bottom` sólo se prueban en dispositivo.
3. **Política de vuelto:** si el negocio prefiere no pedirlo en el checkout, se quita el campo sin tocar nada más.
4. **Tiempo de espera del protocolo de cliente ausente:** 5 minutos es una propuesta, no un dato del negocio.
