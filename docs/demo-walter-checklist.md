# Demo Walter · checklist y guion

Guia operativa para la reunion de demo con Walter. Es complementaria a
`presentacion-walter.md` (el "por que") y a `checklist-demo-walter.md`
(prueba funcional larga). Este archivo es el **libreto corto del dia**.

---

## 1. Objetivo de la reunion

- **Mostrar** la demo funcionando, no vender todavia.
- **Escuchar** que ajustaria, que sacaria y que agregaria.
- **Validar** si le sirve y si conviene adaptarlo a pizzeria, mercadito o ambos.
- Salir con una decision: seguir adaptando o no.

No es objetivo cerrar precio ni prometer fechas de produccion.

---

## 2. Antes de empezar (2 minutos)

- Abrir la app y, si quedaron pedidos de prueba viejos, limpiar la sesion:
  agregar `?reset=1` al final de la URL (por ejemplo
  `http://localhost:8787/?reset=1`) y abrir. Arranca limpio.
- Confirmar que se ve el tema claro premium (fondo claro, no pantalla negra).
- Confirmar que el catalogo carga con fotos.
- Tener el celular cargado y, si vas a mostrar GPS entre dos equipos, abrir el
  link del cliente en uno y el del rider en otro (ver seccion 4).
- Cerrar pestañas y notificaciones que distraigan.

---

## 3. Guion de 5 minutos (un solo equipo)

1. **Abrir Home.** "Este es el local de La Taba online, su propio canal de pedidos."
2. **Agregar un producto.** Tocar un corte o combo y `Agregar`.
3. **Ir a Mi pedido.** Mostrar subtotal, envio y total claros.
4. **Completar la direccion.** Nombre, telefono, calle y numero, barrio,
   referencia. Resaltar que pide la direccion real del cliente.
5. **Confirmar pedido.** Tocar `Confirmar pedido`. Mostrar el aviso de que el
   pedido quedo creado y se sigue en vivo.
6. **Mostrar Seguimiento.** Estado del pedido, mapa de referencia y detalle.
7. **Abrir Negocio.** Codigo `1234`. Mostrar el pedido nuevo entrando, ventas
   del dia, pedidos por estado y stock.
8. **Abrir Rider.** Desde el panel, `Vista rider`. Mostrar el pedido asignado
   con cliente, telefono, direccion y total a cobrar.
9. **Mostrar GPS / contacto / direccion.** Boton para compartir ubicacion,
   botones de llamar y WhatsApp, direccion copiable.
10. **Marcar entregado.** `Salí del local` → `Llegué al domicilio` →
    `Pedido entregado`. Mostrar como cae el estado en seguimiento.

Si algo se traba, recargar la pagina: el pedido sigue guardado.

---

## 4. Variante con dos equipos (GPS en vivo, opcional)

Solo si hay buena conexion y tiempo. Levantar el relay local:

```
npm run realtime:demo
```

- Cliente: `http://localhost:8787/?relay=http://localhost:8787&room=demo-walter`
- Rider: `http://localhost:8787/?relay=http://localhost:8787&room=demo-walter#rider`

Desde el rider, `Opciones avanzadas` permite copiar los links del cliente y del
rider para compartirlos. La ubicacion se comparte solo mientras el reparto
este activo.

---

## 5. Preguntas para Walter

- ¿Esto te serviria mas para pizzeria, mercadito o ambos?
- ¿Que productos o categorias pondrias primero?
- ¿Como reciben los pedidos hoy?
- ¿Quien atiende el WhatsApp?
- ¿Tienen delivery propio o tercerizan?
- ¿Que es lo que mas te molesta de las apps actuales?
- ¿Que sacarias de esta demo?
- ¿Que le agregarias para que funcione en tu negocio?

Anotar las respuestas literales: son la base del siguiente paso.

---

## 6. Cosas que NO decir todavia

- Precio final del sistema.
- Promesas de "producto completo en produccion".
- Que reemplaza Pedido Ya de un dia para otro.
- Tecnicismos: Supabase, commits, backend, relay, repos, base de datos.

Si pregunta por algo tecnico, responder en simple: "es la base, despues se
suma lo que el negocio necesite".

---

## 7. Como posicionarlo

- "Es un **sistema propio de pedidos** para tu local."
- "Es una **demo para adaptar a tu forma de trabajar**."
- "Primero **validamos si te sirve**, despues vemos como seguirlo."

---

## 8. Despues de la reunion

- Volcar las respuestas en `phase-2/walter-discovery-questions.md`.
- Marcar que ajustes pidio y cuales son chicos vs grandes.
- Decidir si conviene una version adaptada (pizzeria / mercadito).
