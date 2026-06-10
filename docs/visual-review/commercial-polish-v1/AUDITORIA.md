# Auditoría visual y comercial — Commercial Polish V1

Fecha: 2026-06-10 · Viewports: 320×568, 390×844, 1280×900.
Capturas "antes" en esta carpeta (`mobile-*`, `desktop-*`, `narrow-*`).

## Hallazgos (antes de los cambios)

### Transversal
1. **Toast tapa contenido**: en móvil el toast se ancla arriba (top 94px; 224px en negocio) y cubre el título o el campo que se está completando.
2. **Copy sin acentos** en superficies visibles: "Pedi directo", "proximos pedidos", "direccion", "Codigo de entrega", "Fidelizacion", "Sin pedidos locales todavia", etc.
3. **Jerga técnica visible**: "Local-first", "Sin GPS vivo" (métrica), "snapshots históricos", chips de marketing en el home.

### Home (cliente)
4. Lead técnico/ventas ("…seguís el reparto real cuando el rider comparte GPS") en lugar de hablar de comida.
5. Chips de estado son claims de producto ("Seguimiento real", "Entrega validada con código") y no info operativa (horario, zona, retiro). Cuando está cerrado dice "Tomamos pedidos" sin avisar que está cerrado.
6. "Promo viernes de parrilla" duplicada en "Ofertas de hoy" y "Combos destacados".

### Catálogo
7. **Cinta "DISPONIBLE" en todas las tarjetas** (ruido de inventario; lo normal no se etiqueta).
8. Hasta 4 badges apilados por foto ("13% OFF" + "COMBO" + "RETIRO" + "DESTACADO") más estrella de favorito.
9. Con búsqueda sin resultados, el rail "Ofertas de la categoría" sigue mostrando productos: contradice el "0 productos".
10. Modal de producto: fila "Disponibilidad" muestra el badge "DESTACADO" en vez de la disponibilidad real.

### Carrito / Checkout
11. Obligatorios sin marcar (Nombre, Teléfono, Calle).
12. "Pedido mínimo delivery" presentado como renglón de importe (parece un cargo).
13. Toast tapa los campos al escribir (ver 1).

### Seguimiento
14. Tarjeta del código de entrega con paleta azul fría, fuera de la paleta cálida.
15. (OK: nota honesta sin GPS, estados claros, sin datos falsos — se conserva tal cual; está fijada por tests.)

### Panel negocio
16. **Página de 21.700px de alto** en móvil (22 pantallas): formulario "Crear producto" siempre abierto + 38 filas de catálogo expandidas + métricas repetidas.
17. Título "Central de pedidos" a 42px envuelve y choca visualmente con el botón de sonido.
18. 8 métricas de crecimiento ANTES de los pedidos nuevos (la prioridad operativa queda abajo).
19. Tabs de filtro en grilla 2×2 con texto truncado ("En prepara…").
20. Tarjeta de pedido nuevo: bloque "Código pendiente / Esperando validación del rider" arriba del botón Aceptar (irrelevante en ese estado) y "Total a cobrar" después de las acciones.
21. Filas del catálogo editable: chip oscuro con texto invisible (stock-pill de tema oscuro sobre fondo claro), ~370px de alto por producto.
22. "Cierre de caja / Local-first" + disclaimer contable extenso.
23. Pedido demo sembrado (LT-0001) con **rider inventado con reputación falsa (4.9★, 128 viajes)**.
24. "Ventas de hoy $20.290" sale del pedido sembrado sin transparentarlo al presentador.

### Rider
25. "Ubicación detenida" repetido 4 veces en la misma tarjeta (chip, Estado, Señal, línea inferior) + botón "Detener ubicación" deshabilitado siempre visible.
26. Botón "Compartir ubicación real" con dorado distinto del cobre del resto.

### Demo comercial
27. No existe una pantalla/modal de presentación comercial para el dueño.
28. No hay un control del presentador para reiniciar la demo sin tipear `?reset=1`.

## Decisiones
- La nota de GPS del tracking ("Sin GPS en vivo. Seguimiento por estado…") **no se toca**: es honesta y está fijada en 4 specs e2e.
- El pedido sembrado LT-0001 **se conserva** (tests y legibilidad del panel) pero se le quita la reputación falsa del rider y se transparenta en la guía demo con botón de reinicio.
- El modal de presentación se abre con `?pitch=1` o desde Local (nunca automático, para no molestar a recurrentes ni romper e2e).
