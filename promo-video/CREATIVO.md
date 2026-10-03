# TABA · Video promocional vertical — Documento creativo
2026-08-28 · Proyecto: `la-taba-pages-preview` · rama `feature/taba-business-panel-automation` @ `523d3d0`

---

## 1 · Diagnóstico del intento anterior (por qué era flojo)

1. **El producto no era el protagonista: era una ilustración.** Se reemplazó la interfaz real
   por imágenes demo, mockups y recursos de relleno. Un video comercial de software vende
   *evidencia*; cada imagen que no sale del producto real resta credibilidad en vez de sumarla.
2. **Lógica de presentación, no de comercial.** Una sucesión de láminas explica; no vende.
   Sin interacción visible (toques, scroll, estados cambiando) no hay prueba de que el
   software funciona, y sin narrativa no hay razón para mirar hasta el final.
3. **Estética genérica ≠ TABA.** El producto ya tiene una identidad fuerte (negro/grafito
   `#101317` + rojo `#d0000d`, tipografía system, tarjetas blancas de producto). Cualquier
   plantilla externa diluye eso y baja el nivel percibido.
4. **La causa técnica de fondo (descubierta en la auditoría):** el catálogo demo del repo
   bloquea sus propias fotos — todas están marcadas `RETAILER_SOLO_REFERENCIA` y el modelo
   de derechos del producto se niega (correctamente) a publicarlas, entonces la góndola demo
   muestra placeholders. El intento anterior probablemente tapó ese hueco con imágenes
   falsas en vez de usar el estado publicado real: los packshots de los SKU unitarios
   (Red Bull, Speed, Monster, Heineken…) ya viven en el repo y son los que producción
   muestra hoy en la tienda pública. La solución correcta era espejar ese estado publicado
   en el entorno demo controlado — no inventar imágenes.

## 2 · Tres conceptos creativos

**A — «UN PEDIDO, DE PUNTA A PUNTA»** *(elegido)*
Un único pedido real (código LT-XXXX) atraviesa el sistema completo: el cliente lo arma y
lo confirma → entra solo al panel del negocio con timbre → el reparto lo acepta → el
cliente lo ve llegar en vivo sobre el mapa de Neuquén → código de entrega. El mismo
código, el mismo monto y el mismo nombre aparecen en las cuatro pantallas.
*Por qué vende:* la continuidad es la prueba. Un mockup no puede fingir un pedido que
persiste entre roles; esto demuestra que hay un sistema de verdad detrás del front.

**B — «DOS PANTALLAS, UN NEGOCIO»**
Montaje alternado 1:1 entre lo que ve el cliente y lo que ve el comercio, convergiendo en
el mapa. Empatiza rápido con el comerciante ("vos ves esto"), pero el corte constante de
contexto cada ~2 s exige más del espectador y debilita la sensación de recorrido.

**C — «ESTO NO ES UNA PLANTILLA»**
Manifiesto tipográfico sobre montaje rápido de UI real: "Tu marca. Tus pedidos. Tu
sistema." Máximo estilo y ritmo, mínima prueba de proceso: el riesgo es quedar en la
categoría de "humo lindo", exactamente lo que hay que evitar después del intento fallido.

**Elección: A**, absorbiendo lo mejor de B (etiquetas de punto de vista: «LO QUE VE TU
CLIENTE / LO QUE VE TU NEGOCIO / EL REPARTO») y de C (gancho tipográfico fuerte y placas
de cierre). Es el único concepto cuya fuerza aumenta con el producto real y no depende de
ningún recurso externo.

## 3 · Reglas de honestidad de esta producción

- Todo lo que se ve en pantalla es la aplicación real de la rama validada, corriendo local
  en modo demo (`?demo=1`) o el panel operativo con servidor simulado controlado (el mismo
  arnés de fixtures que usan las suites E2E del repo).
- Datos de prueba: cliente "Julieta Herrera", dirección demo "Avenida Argentina 450",
  pedidos LT-00xx, repartidor de fixtures. Ninguna persona real, ningún dato real.
- Fotos de producto: se espeja en la demo el estado publicado de producción (packshots
  reales de los SKU unitarios que ya están commiteados en `assets/catalog/beverages/` y
  que la tienda pública muestra hoy). El espejo es un override de runtime sólo en el
  navegador de grabación; el repo no se toca.
- No se muestra: Mercado Pago, consola/debug, credenciales, alcohol como protagonista
  (los héroes de cámara son energizantes), pantallas inventadas, secciones de alertas.
- Mapa: © OpenStreetMap (crédito discreto sobre las tomas de mapa; la app además muestra
  su control de atribución).

## 4 · Storyboard (35 s · 1080×1920 · 30 fps · sin audio)

| # | Tiempo | Pantalla real | Acción visible | Texto sobreimpreso |
|---|--------|---------------|----------------|--------------------|
| 1 | 0.0–1.3 | Mapa Seguir: moto en ruta roja, ETA | moto avanzando (cold open) | «¿Y si tu comercio tuviera esto?» |
| 2 | 1.3–2.3 | Catálogo: góndola con fotos reales | scroll ágil | «Su propio sistema de pedidos y delivery.» |
| 3 | 2.3–3.4 | Panel: toast «Nuevo pedido LT-XXXX» | pedido entrando solo | (continúa el texto anterior) |
| — | | **CAPÍTULO 1 · LO QUE VE TU CLIENTE** | | chip «LO QUE VE TU CLIENTE» |
| 4 | 3.4–5.2 | Home → Catálogo | tap nav, scroll góndola con fotos reales | «Tu catálogo, con tu marca» |
| 5 | 5.2–7.2 | Ficha de producto | tap tarjeta → modal Red Bull → «Agregar al pedido» | — |
| 6 | 7.2–9.2 | Carrito «Tu pedido» | cantidad ×2, mínimo alcanzado, scroll a resumen | «Pedido en segundos» |
| 7 | 9.2–11.4 | Checkout compacto | dirección confirmada + Efectivo → tap «Confirmar pedido» | — |
| 8 | 11.4–13.2 | «Tu pedido fue confirmado» + timeline | toast «Pedido confirmado» | «Confirmado. Sin llamadas, sin planillas.» |
| — | | **CAPÍTULO 2 · LO QUE VE TU NEGOCIO** | | chip «LO QUE VE TU NEGOCIO» |
| 9 | 13.2–15.0 | Panel del negocio (bandeja) | cola en curso, «3 en curso» | «El negocio tiene su panel» |
| 10 | 15.0–17.2 | Bandeja | **LT-XXXX entra solo** + toast + contador «1 nuevo» | «El pedido entra solo, con timbre» |
| 11 | 17.2–19.4 | Tarjeta LT-XXXX | tap «Aceptar pedido» → pasa a EN PREPARACIÓN | «Estados claros. Cola bajo control.» |
| — | | **CAPÍTULO 3 · EL REPARTO** | | chip «EL REPARTO» |
| 12 | 19.4–21.6 | Vista repartidor | «Entrega disponible · LT-XXXX» → tap «Aceptar entrega» → salir → «Iniciar recorrido» | «El reparto, coordinado» |
| — | | **CAPÍTULO 4 · EN VIVO** | | chip «LO QUE VE TU CLIENTE, EN VIVO» |
| 13 | 21.6–26.4 | Mapa Seguir | moto recorre ruta real de Neuquén, ETA baja, cámara sigue | «Seguimiento en vivo sobre el mapa» |
| 14 | 26.4–29.0 | Llegada | «El repartidor está en tu domicilio» → scroll a **Código de entrega 4 dígitos** | «Entrega con código de seguridad» |
| — | | **CIERRE** | | |
| 15 | 29.0–31.4 | Placa 1 (negro TABA) | logotipo real La Taba | «Esto es TABA. Una plataforma real, funcionando hoy.» |
| 16 | 31.4–35.0 | Placa 2 (LUNA) | marca LUNA | «Una muestra de lo que podemos construir para tu negocio.» · «Software a medida · LUNA» · CTA «Contanos qué necesita tu negocio» |

Transición entre capítulos: corte seco o slide-up 0.25 s. Dentro de capítulo: cortes secos
y compresión temporal (1.5–4×) en tramos sin toque. Toques siempre a velocidad real con
indicador de toque sutil.

## 5 · Shot list exacta (grabación Playwright, 432×768 css @2.5 dppx → 1080×1920)

**Sesión W1 · mundo demo cliente (contexto A, fotos espejadas, perfil sembrado):**
1. `S1a` Home demo (hero + categorías) — hold 1 s.
2. `S1b` Tap nav «Catálogo» → góndola (Red Bull/Speed/Speed Zero/Monster con foto) — scroll suave 600 px.
3. `S1c` Tap tarjeta Red Bull → modal ficha (foto real, precio, «Disponible») → tap «Agregar al pedido».
4. `S1d` Tap «+» (cantidad 2) → carrito flotante — tap carrito.
5. `S1e` Vista «Tu pedido»: ítem con foto ×2, barra «Ya alcanzaste el pedido mínimo» — scroll.
6. `S1f` Checkout compacto: dirección «Casa · Ubicación confirmada», «Efectivo al recibir», resumen $ — tap «Confirmar pedido».
7. `S1g` Toast «Pedido confirmado» → «Tu pedido fue confirmado» + timeline 4 pasos — hold 1.4 s.

**Sesión W2 · panel operativo (contexto B, fixture de servidor controlado):**
8. `S2a` Bandeja con 3 pedidos en curso (EN PREPARACIÓN / LISTOS / EN REPARTO), timbre activado — hold 1 s.
9. `S2b` Entra `LT-XXXX · Julieta Herrera · 2× Red Bull · $` → toast «Nuevo pedido LT-XXXX» + «1 nuevo · 3 en curso».
10. `S2c` Tap «Aceptar pedido» → tarjeta pasa a EN PREPARACIÓN — hold 0.8 s.

**Sesión W3 · repartidor + seguimiento (contexto A, continúa el mismo pedido):**
11. `S3a` (prep off-cam: negocio demo avanza el pedido a listo) Vista rider: «Entrega disponible · LT-XXXX · A cobrar $ · Efectivo» → tap «Aceptar entrega».
12. `S3b` Tap salir a repartir → tap «Iniciar recorrido».
13. `S4a` Vista Seguir (sin recarga): mapa nocturno, ruta roja, moto sale del local, ETA — 24 s de recorrido completos (se comprimen en edición).
14. `S4b` Estado llegada: «El repartidor está en tu domicilio» → scroll a «Código de entrega» — hold 1.2 s.

**Placas (HTML → PNG, tipografía system + tokens de marca):**
15. `S5a` Placa TABA (logotipo real capturado de la app).
16. `S5b` Placa LUNA + CTA.

## 6 · Textos sobreimpresos finales (es-AR)

- Gancho: **«¿Y si tu comercio tuviera esto?» → «Su propio sistema de pedidos y delivery.»**
- Chips de capítulo: «LO QUE VE TU CLIENTE» · «LO QUE VE TU NEGOCIO» · «EL REPARTO» · «TU CLIENTE LO VE · EN VIVO»
- Capítulo cliente: «Tu catálogo, con tu marca» · «Pedido en segundos» · «Confirmado. Sin llamadas, sin planillas.»
- Capítulo negocio: «El negocio tiene su panel» · «El pedido entra solo, con timbre» · «Estados claros. Cola bajo control.»
- Reparto: «El reparto, coordinado»
- En vivo: «Seguimiento en vivo sobre el mapa» · «Entrega con código de seguridad»
- Cierre 1: «Esto es TABA.» · «Una plataforma real, funcionando hoy.»
- Cierre 2: «Una muestra de lo que podemos construir para tu negocio.» · «Software a medida» · **LUNA** · CTA: «Contanos qué necesita tu negocio»
- Crédito discreto en tomas de mapa: «Mapa © OpenStreetMap»

## 7 · Versión corta (~15 s)

Mapa (1.2) → góndola + agregar (2.6) → confirmar pedido (2.2) → pedido entra al panel +
aceptar (3.6) → moto en vivo + código de entrega (3.4) → placa LUNA + CTA (2.5).

## 8 · Corte final (as built)

- **Principal:** 33,2 s · 1080×1920 · 30 fps · H.264 · 7,4 MB · sin audio (Reels/Stories agregan música propia).
- **Corta:** 15,1 s · 3,7 MB.
- Capítulos: gancho 0–3,2 · cliente 3,2–12,4 · negocio 12,4–18,5 · reparto 18,5–19,9 · en vivo 19,9–27,5 · placas 27,5–33,2.
- Cambios respecto del plan: el gancho quedó «¿Y si tu comercio tuviera esto?» sobre la moto
  (más fuerte que la versión larga); el checkout cierra en elipsis (carrito → «Datos de
  entrega» → corte → «Pedido confirmado»), y el «Iniciar recorrido» del rider quedó fuera de
  cámara — el capítulo EN VIVO abre con el toast real «Recorrido guiado iniciado».
- Pipeline: captura por ráfaga de screenshots físicos 1080×1920 (CDP `clip.scale=2.5`,
  ~15–21 fps) con timestamp epoch por cuadro → corte por reloj + rampas de velocidad
  (1,1×–3,3×) re-muestreadas a 30 fps → xfade entre capítulos → sobreimpresos PNG.
  Todo regenerable: `scripts/record-takes.mjs` → `scripts/build-edit.mjs` / `build-short.mjs`.

## 9 · Hallazgos de producto que destapó la producción (backlog)

1. En demo a 432 px con perfil sembrado, entre el resumen del carrito y el botón
   «Confirmar pedido» hay un vacío negro de varios miles de px (la vista compacta deja
   espacio del formulario retirado). Un cliente que scrollea lo ve.
2. Hay un botón «Confirmar pedido» duplicado y oculto en el DOM (rompe cualquier
   querySelector ingenuo; Playwright lo esquiva por visibilidad).
3. La vista del repartidor queda en blanco un instante tras «Aceptar entrega» y tras
   «Marcar en camino» (re-render completo de la lista).
4. El dataset demo bloquea todas sus fotos por derechos (`RETAILER_SOLO_REFERENCIA`)
   aunque producción ya publica packshots reales de esos mismos SKU unitarios: la demo
   merece un refresh de `rightsStatus` para volver a ser presentable.
