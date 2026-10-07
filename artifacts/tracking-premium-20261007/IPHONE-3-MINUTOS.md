# Safari en iPhone · prueba física de menos de 3 minutos

Estado: **IPHONE_REAL: NOT_RUN**. WebKit emulado y eventos TouchEvent no certifican el gesto físico de iOS.

Usar un pedido de QA en el candidato o una preview aprobada; el PR no está desplegado en producción. No confirmar una compra ni un pago para hacer esta prueba. La pantalla de evidencia y el video tienen datos sintéticos; el mapa y la interacción pertenecen a la aplicación real.

1. **0:00–0:30 · Pan y scroll.** Abrir Seguimiento con un Rider en camino. Deslizar un dedo horizontalmente/diagonalmente dentro del mapa: mueve el mapa y aparece “Seguir repartidor”. Deslizar claramente hacia arriba desde el centro del mapa: la página baja y se pueden leer los detalles. No debe aparecer “Use two fingers…”.
2. **0:30–1:00 · Pinch.** Pellizcar para acercar/alejar. El norte permanece arriba. El mapa no rota ni se inclina. Un tap luego del pan no debe activar una acción accidental.
3. **1:00–1:30 · Seguir.** Con el mapa en modo explorar, recibir un GPS nuevo: la cámara conserva el encuadre elegido. Tocar “Seguir repartidor”: vuelve con suavidad, Rider y destino visibles. Recibir otro GPS: marker y cámara acompañan sin saltos.
4. **1:30–2:15 · Volver de otra app.** Dejar activo seguir, cambiar a otra app 10 segundos y volver. Se muestra la posición actual, sin recorrer puntos antiguos. Repetir una vez en modo explorar: debe conservar el encuadre manual.
5. **2:15–2:45 · Dirección y accesibilidad.** Abrir el selector de ubicación, mover horizontalmente con un dedo y hacer pinch. Un tap intencional selecciona el punto. Cerrar conserva el formulario. Si está activado “Reducir movimiento”, las acciones siguen funcionando sin springs/pulsos.

Resultado esperado: pan de un dedo, pinch, scroll vertical accesible, override respetado, control de seguir operable, sin salto/replay/flicker. La intención se fija al comienzo de cada gesto: vertical = página; horizontal/diagonal = mapa. No se necesita buscar un borde para bajar.

Registrar modelo, versión de iOS/Safari, resultado de cada paso y cualquier problema. No marcar PASS general si falta un paso o el GPS de QA no está disponible.
