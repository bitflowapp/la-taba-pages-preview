# Demo Walter · checklist y guion

Libreto corto del día para mostrarle **La Taba** a Walter. Es el archivo
principal de la reunión. Complementa a `presentacion-walter.md` (el "por qué")
y a `checklist-demo-walter.md` (prueba funcional larga).

> Nota: este checklist refleja la app actual. El botón principal del pedido es
> **Confirmar pedido** (WhatsApp quedó como copia opcional, ya no es el botón
> principal). Si algún doc viejo dice "Enviar pedido por WhatsApp", mandá por lo
> que dice acá.

---

## 0. Link para abrir en el iPhone

Abrir **siempre con `?reset=1`** para arrancar limpio (sin pedidos de prueba
viejos):

```
https://bitflowapp.github.io/la-taba-pages-preview/?reset=1&v=walter-demo-final
```

Si el celu muestra una versión vieja en caché, usar el mismo link cambiando el
final:

```
https://bitflowapp.github.io/la-taba-pages-preview/?reset=1&v=walter-demo-final-2
```

Tip: subir el brillo del celular y cerrar notificaciones antes de mostrarlo.

---

## 1. Objetivo de la reunión

- **Mostrar** la demo funcionando.
- **Escuchar** qué le sirve, qué ajustaría, qué sacaría y qué agregaría.
- **Validar** si conviene adaptarla a su pizzería, su mercadito o ambos.

No es objetivo de hoy: **no vender todavía**, no cerrar precio, no prometer
fechas de producción.

---

## 2. Frase inicial sugerida (decila vos, Marco)

> "Walter, no te vengo a vender nada todavía. Te traje una demo funcionando para
> ver si tiene sentido adaptarla a tu forma real de trabajar. La idea es que me
> digas qué sirve, qué sacarías y qué habría que cambiar."

---

## 3. Antes de empezar (1 minuto)

- Abrir el link con `?reset=1` (sección 0). Arranca limpio.
- Confirmar que se ve el **tema claro premium** (fondo claro, no pantalla negra).
- Confirmar que el **catálogo carga con fotos**.
- Recordá que el **Panel negocio muestra datos de ejemplo** (una venta del día
  ya cargada) para que no se vea vacío. Avisalo si Walter pregunta por los
  números.

---

## 4. Guion de 5 minutos (un solo equipo)

1. **Home.** "Este es La Taba online: su propio canal de pedidos, con su marca."
2. **Catálogo.** Entrar y tocar una categoría (Carnes, Combos).
3. **Agregar un producto.** Tocar un corte o combo y `Agregar`.
4. **Mi pedido.** Mostrar subtotal, envío y total claros, y el pedido mínimo.
5. **Cargar la dirección real.** Nombre, teléfono, calle y número, barrio y
   referencia. Resaltar que pide la **dirección real del cliente**, no una
   genérica.
6. **Confirmar pedido.** Tocar `Confirmar pedido`. Mostrar el aviso de que el
   pedido **quedó creado y se sigue en vivo**. (No abre WhatsApp solo; "Enviar
   copia por WhatsApp" es opcional.)
7. **Seguimiento.** Estado del pedido, mapa de referencia, dirección real y el
   estado **"Repartidor sin asignar"** hasta que el negocio lo despacha (es
   honesto: no inventa un repartidor que no existe).
8. **Panel negocio.** Código `1234`. Mostrar el pedido nuevo entrando, ventas
   del día, pedidos por estado y stock rápido.
9. **Vista rider.** Desde el panel, `Vista rider`. Mostrar el pedido asignado
   con cliente, teléfono, dirección y total a cobrar, más los botones de
   compartir ubicación, llamar y WhatsApp.
10. **Marcar entregado.** `Salí del local` → `Llegué al domicilio` → `Pedido
    entregado`. Volver a Seguimiento y mostrar cómo cae el estado.

Cerrar con las preguntas de la sección 6.

Si algo se traba: **recargar la página**, el pedido queda guardado. Para empezar
de cero, volver a abrir con `?reset=1`.

---

## 5. Cómo explicar GPS / dirección / contacto (en simple)

- La dirección que se ve es la **que carga el cliente**, no una inventada.
- En un solo celular, el mapa es una **referencia de recorrido**.
- Con **dos celulares** (uno cliente, uno repartidor) el GPS es **real y en
  vivo**. Eso se muestra solo si hay tiempo y buena conexión (sección 7).

---

## 6. Preguntas para Walter

Anotar las respuestas **literales**: son la base del próximo paso.

- ¿Lo ves más para **pizzería, mercadito o ambos**?
- ¿Qué **productos o categorías** cargarías primero?
- ¿Cómo **reciben los pedidos hoy**?
- ¿Quién **mira el WhatsApp**?
- ¿Tienen **delivery propio** o tercerizan?
- ¿Qué parte de esto te **ordenaría más el trabajo**?
- ¿Qué **sacarías** de esta demo?
- ¿Qué **agregarías** para que funcione en tu negocio?
- ¿Qué **tendría que pasar para que esto te sirva de verdad**?

---

## 7. Variante con dos equipos (GPS en vivo, opcional)

Solo si hay buena conexión y tiempo. Levantar el relay local:

```
npm run realtime:demo
```

- Cliente: `http://localhost:8787/?relay=http://localhost:8787&room=demo-walter`
- Rider: `http://localhost:8787/?relay=http://localhost:8787&room=demo-walter#rider`

Desde el rider, `Opciones avanzadas` permite copiar los links del cliente y del
rider para compartirlos. La ubicación se comparte solo mientras el reparto está
activo.

---

## 8. Qué NO decir todavía

- Precio final del sistema.
- Tecnicismos: Supabase, backend, base de datos, commits, repos, relay.
- Que tiene **IA** o que "lo hace una IA".
- Que **reemplaza Pedido Ya** de un día para el otro.
- "Producción completa", "listo para miles de usuarios", "sistema definitivo".

Si pregunta por algo técnico, responder simple: "es la base; después se le suma
lo que el negocio necesite".

---

## 9. Qué SÍ decir

- "Es un **canal propio de pedidos** para tu local."
- "Es una **demo funcional**, no una maqueta."
- "Es **adaptable a tu comercio** (pizzería o mercadito)."
- "**Primero vemos si encaja con tu operación**; después vemos cómo seguir."

---

## 10. Después de la reunión

- Volcar las respuestas en `phase-2/walter-discovery-questions.md`.
- Marcar qué ajustes pidió y cuáles son **chicos vs. grandes**.
- Decidir si conviene una **versión adaptada** (pizzería / mercadito).
