# Demo Walter · checklist y guion

Libreto corto del día para mostrarle **La Taba** a Walter. Refleja la app actual,
con la **Central de pedidos** del negocio (PR #29). Complementa a
`presentacion-walter.md` (el "por qué").

> La app actual: el cliente confirma un pedido → **cae en la Central de pedidos**
> del negocio → el negocio lo acepta, prepara, marca listo y manda a reparto → el
> cliente ve el estado en vivo → el rider toma el pedido correcto → el GPS es
> **honesto** (sin ruta falsa, sin km/ETA inventados, sin marcadores LT/CL falsos).

---

## 0. Link para abrir en el iPhone

Abrir **siempre con `?reset=1`** para arrancar limpio:

```
https://bitflowapp.github.io/la-taba-pages-preview/?reset=1&v=walter-business-inbox-v1
```

Si el celu muestra una versión vieja en caché, cambiá el final del link
(`&v=walter-business-inbox-v1-2`). Subí el brillo y cerrá notificaciones.

---

## 1. Objetivo de la reunión

- **Mostrar** la demo funcionando.
- **Escuchar** qué le sirve, qué ajustaría, qué sacaría y qué agregaría.
- **Validar** si conviene adaptarla a su pizzería, su mercadito o ambos.

Hoy **no se vende**, no se cierra precio, no se prometen fechas.

---

## 2. Frase inicial (decila vos, Marco)

> "Walter, no te vengo a vender nada todavía. Te traje una demo funcionando para
> ver si tiene sentido adaptarla a tu forma real de trabajar. Quiero que me digas
> qué sirve, qué sacarías y qué habría que cambiar."

---

## 3. Antes de empezar (1 minuto)

- Abrir el link con `?reset=1` (sección 0). Arranca limpio.
- Confirmar tema claro premium (fondo claro) y que el catálogo carga con fotos.
- Recordá que el **panel muestra datos de ejemplo** (una venta del día) para que
  no se vea vacío. Avisalo si Walter pregunta por los números.

---

## 4. Guion de 5 minutos (un solo equipo)

1. **Home.** "Este sería **tu canal propio de pedidos**, con tu marca."
2. **Catálogo.** Mostrar productos, promos y precios. Agregar un producto.
3. **Carrito / Checkout.** Mostrar el **total**, cargar **dirección real** (calle
   y número), **barrio** y **referencia**, y tocar **Confirmar pedido**.
4. **Seguimiento (cliente).** Mostrar el **estado** del pedido y la **dirección
   real**. Si todavía no salió el repartidor dice **"Sin GPS en vivo"**.
   Resaltar: **no inventa ruta ni kilómetros** — si no hay GPS real, no muestra
   un mapa como si lo hubiera.
5. **Central de pedidos (negocio).** Ir a **Local** → **Panel negocio** → PIN
   **`1234`**. Mostrar cómo **el pedido que acaba de confirmar el cliente cae acá**.
   Abrir la card: **cliente, teléfono, dirección, barrio, referencia, productos,
   cantidades, total y notas**. Decir: **"Acá es donde el comercio trabaja el
   pedido."**
6. **Acciones del negocio.** Sobre la misma card: **Aceptar pedido → Preparar →
   Listo para entregar → Enviar a reparto**. Después volvé a **Seguimiento** y
   mostrá que **el cliente ve el estado actualizado**.
7. **Rider.** Desde el panel, **Vista rider**: aparece el **pedido correcto** con
   dirección, total a cobrar y contacto (Llamar / WhatsApp). Botón **"Compartir
   mi ubicación real"** (se usa de verdad si hay dos celulares).
8. **GPS en vivo (opcional).** Solo si el relay/ngrok está abierto (sección 8):
   "Con **dos celulares**, el rider comparte su ubicación **real** y el cliente la
   ve en vivo." Aclarar: **"Si no hay GPS real, la app no inventa nada."**
9. **Cierre.** Pasar a las preguntas (sección 5).

Si algo se traba: recargá; el pedido queda guardado. Para empezar de cero,
volvé a abrir con `?reset=1`.

---

## 5. Cierre · preguntas para Walter

Anotar las respuestas **literales**: son la base del próximo paso.

- ¿Qué de esto te **sirve** y qué **sacarías**?
- ¿Qué **cambiarías** para que funcione en tu negocio?
- ¿Lo ves más para **pizzería, mercadito o ambos**?
- ¿Cómo **recibís los pedidos hoy**?
- ¿Quién **mira el WhatsApp**?
- ¿Tenés **delivery propio** o tercerizás?
- ¿Qué parte de esto te **ordenaría más el trabajo**?

---

## 6. Qué SÍ decir

- "Es un **canal propio de pedidos** para tu local."
- "Es una **demo funcional**, no una maqueta."
- "Tiene una **Central de pedidos** para ordenar la operación."
- "Es **adaptable a tu comercio** (pizzería o mercadito)."
- "**Primero validamos si encaja con tu forma real de trabajar**, después vemos cómo seguir."

---

## 7. Qué NO decir

- Que ya es **producción final**.
- Que **guarda los pedidos para siempre en un servidor** (hoy es demo en el equipo).
- Que **funciona entre celulares sin relay / túnel**.
- Tecnicismos: **Supabase, Firebase, backend, base de datos**.
- Que tiene **IA**.
- Prometer **pagos online** todavía.
- Que **reemplaza Pedido Ya** de un día para el otro.

Si pregunta por algo técnico: "es la base; después se le suma lo que el negocio necesite".

---

## 8. GPS en vivo con dos equipos (opcional)

Solo si el **relay/ngrok** está activo y hay buena conexión. Abrí cada link en un
celular distinto (uno cliente, uno rider). La ubicación se comparte **solo
mientras el reparto está activo**; al cortar, vuelve a **"Sin GPS en vivo"**.

---

## 9. Links finales

**Demo pública (recomendado para mostrar):**
```
https://bitflowapp.github.io/la-taba-pages-preview/?reset=1&v=walter-business-inbox-v1
```

**GPS en vivo con ngrok (solo si el túnel sigue abierto):**

Cliente:
```
https://wieldiest-etha-unrippable.ngrok-free.dev/?reset=1&relay=https%3A%2F%2Fwieldiest-etha-unrippable.ngrok-free.dev&room=demo-walter
```

Rider:
```
https://wieldiest-etha-unrippable.ngrok-free.dev/?relay=https%3A%2F%2Fwieldiest-etha-unrippable.ngrok-free.dev&room=demo-walter#rider
```

> Los links de ngrok son temporales (cambian cada vez que se reinicia el túnel).
> Si no abren, mostrá la demo pública: el flujo cliente → Central de pedidos →
> negocio funciona igual en un solo equipo (sin GPS en vivo entre celulares).

---

## 10. Después de la reunión

- Volcar las respuestas en `phase-2/walter-discovery-questions.md`.
- Marcar qué ajustes pidió y cuáles son **chicos vs. grandes**.
- Decidir si conviene una **versión adaptada** (pizzería / mercadito).
