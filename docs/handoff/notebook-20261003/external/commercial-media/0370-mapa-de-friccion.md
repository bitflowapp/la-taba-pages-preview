# Mapa de fricción — Storefront TABA2 / La Taba 2

HEAD `08bb17a0` · demo local `?reset=1&demo=1` · 320/390/432/1280 · 2026-08-05.
Leyenda: 🟢 fluido · 🟡 duda · 🟠 fricción · 🔴 abandono probable · ♻️ recuperación disponible.

---

## Recorrido troncal

### 1. Entrada (home)

- 🟢 **Cinco segundos:** "¡Bienvenido a La Taba 2!" + "Tienda de bebidas · Mendoza 827, Neuquén" + chip "Pedidos disponibles" + productos con precio. Qué es, de quién es, dónde está y que está operativo: todo en el primer pantallazo (390/432).
- 🟢 Cero ruido técnico: sin badges de preview, sin errores, sin saltos de layout (overflow 0 medido).
- 🟡 **A 320×568** el primer producto con precio y "Agregar" queda a 686 px, bajo el pliegue: el primer pantallazo vende marca y búsqueda, no producto (P2-2). ♻️ El scroll natural lo resuelve a un gesto.
- 🟡 El aro de historias con "4 historias nuevas" compite bien sin robar protagonismo; correcto.

### 2. Descubrimiento

- 🟢 Buscador en home salta al catálogo con resultados en vivo; "No encontramos «…» / Probá con la marca o la presentación" con salidas claras. Favoritos y "Más" categorías, todo ≥ 44 px.
- 🔴 **"Ver todos" de Destacados → "Todos / 0 productos"** (P1-1). El comprador más caliente aterriza en una tienda que se declara vacía. ♻️ Recuperación existe ("Ver todo el catálogo") pero exige que el cliente no se haya ido ya con la peor impresión posible.
- 🟠 **Banners "El mejor whisky" y "Fernet y amargos" → rubros con 0 comprables**; historia "Jack Daniel's en la barra" → whisky con 1 producto sin precio y de otra marca (P1-2). La vidriera editorial invita a pasillos vacíos. ♻️ Chips de rubros comprables siempre a un toque.
- 🟠 **Búsqueda "fernet"** (la búsqueda argentina por excelencia acá): 3 resultados, los 3 "Precio próximamente", sin ninguna salida comercial (ni aviso, ni contacto). Idem vinos, whisky, gin, aguas: **10 rubros sin un solo comprable**. Es gate de datos del negocio, pero el cliente lo vive como límite de la tienda.
- 🟡 Filtros potentes pero con slugs ("botella-pet") y capacidades desordenadas (P2-3): el sheet no se cierra tocando afuera (solo "Aplicar").

### 3. Producto

- 🟢 Card → ficha en un toque; ficha con presentación, variantes, disponibilidad textual, observación ("Ej.: bien fría"), aviso de mayoría de edad, precio grande y "Agregar" directo. Favorito con estado accesible.
- 🟢 Sin precio: honestidad ejemplar — "Precio próximamente / Este producto todavía no está disponible para compra" + "Ver detalle" + "Guardar para después". Nunca "$ 0", nunca promesa.
- 🟡 **Duda sin respuesta:** "¿y cuándo va a estar?" No hay puente (ni fecha, ni aviso, ni contacto). Único camino: favoritos. El cliente puede malinterpretar "no lo venden más".

### 4. Carrito

- 🟢 Stepper claro (papelera a cantidad 1), línea por ítem, "Ya alcanzaste el pedido mínimo" o "Te faltan $ X…" con progreso, "El costo de envío se informa por separado" — coherente con el badge que muestra subtotal.
- 🟢 Doble toque del mismo producto = cantidad 2 (nunca línea duplicada); anti-rebote 120 ms; "Vaciar carrito" pide confirmación y aclara que no afecta pedidos confirmados.
- 🟢 Persistencia: carrito y pedido sobreviven al cierre/recarga. Estado vacío con "Pedido en curso · Ver seguimiento" cuando corresponde.
- 🟡 "RECOMENDADOS PARA VOS" ofrece packs de $ 17.100–19.999 junto a un carrito de $ 7.800: lectura "me empujan lo caro" (P2-6).

### 5. Checkout

- 🟢 **Dos decisiones reales:** Delivery/Retiro y cuál dirección. Todo lo demás viene de Perfil ("Tus datos", "Editar en Perfil"). Totales instantáneos y correctos: envío $ 1.990 / retiro $ 0 / mínimo $ 5.000 como fila informativa. Edad solo si hay alcohol. "Tu pedido está protegido."
- 🟠 **Modal "ANTES DE PAGAR"** intercepta el primer tap de Confirmar cuando una regla aplica (cerveza sin acompañamiento), **incluso con el pedido inválido**: primero upsell de $ 19.999, después el error "Te faltan $ 1.100…" (P1-3). Un tap extra en el momento de máxima intención.
- 🟡 **Bug del aviso:** tras un error inline, cambiar cualquier campo lo limpia y el aviso vivo del mínimo queda oculto — cliente bajo mínimo sin guía visible hasta reintentar (P2-1).
- 🟡 Para el desconfiado: pago "A coordinar con el local" + WhatsApp "a confirmar" + horarios "a confirmar" = puede frenar justo acá. (Dato faltante del negocio, no diseño.)
- 🟢 Doble submit: un solo pedido, botón "Creando pedido…" (verificado con clicks repetidos).

### 6. Confirmación y seguimiento

- 🟢 Inmediata: "Tu pedido fue confirmado", timeline Confirmado→Preparando→En camino→Entregado, tarjeta honesta "El pedido sigue en el local", "Repartidor aún no asignado", resumen completo (ítems, envío, "Pago: Efectivo", total, referencia de entrega). Toast "Pedido confirmado. Seguilo en Seguimiento."
- 🟢 ♻️ Recuperación total del contexto: banner "Tenés un pedido en curso · LT-0002 · Recibido" en home y en carrito vacío; sobrevive a recargar y volver.
- 🟡 **El estado no avanza solo** (verificado: 9 s después sigue "Confirmado"; en demo avanza solo si el panel del negocio opera). "Te avisaremos cada avance" + quietud prolongada = duda a los minutos. Para demo comercial conviene guionarlo (operar el panel en vivo); para producción el flujo real lo cubre.

---

## Personas (prueba de conversión)

### 1 · Sabe qué bebida quiere
- **Si quiere gaseosa/cerveza/energizante/mixer:** convierte en ~4 toques (buscar → Agregar → carrito → Confirmar). Sin decisiones innecesarias (0–1 si salta el modal de sugerencias).
- **Si quiere fernet/vino/whisky/gin/agua:** 🔴 muro "Precio próximamente" sin salida. Malinterpreta: "no lo venden / no abrió". Aumenta confianza: que lo comprable tenga precio firme. Reduce conversión: el muro sin puente (favorito es lo único).

### 2 · Explorador de ofertas
- No hay "Ofertas del día" (honesto: no existen promos aprobadas) ni precios tachados. 🟠 Los banners "SELECCIÓN PREMIUM"/"CLÁSICO ARGENTINO" son lo más parecido a una promo y hoy decepcionan (P1-2). Malinterpreta: editorial como oferta. Abandono: medio. Palanca real pendiente del negocio: cargar una promoción verdadera.

### 3 · Persona mayor, poca experiencia digital
- 🟢 Una columna, tipografía generosa, botones grandes y con texto, select de pago nativo, "Efectivo al recibir", confirmación con palabras simples. Decisiones innecesarias: el modal de sugerencias si aplica (P1-3) y el sheet de filtros (evitable: los chips alcanzan). Riesgo menor: historias a pantalla completa sin cierre por tap afuera (P2-9). Convierte si su bebida está entre las 20.

### 4 · Apurado, una mano
- 🟢 Todo en zona de pulgar: nav inferior, barra flotante "Ver carrito · $", CTA al fondo del checkout. 🟠 Fricciones: modal de sugerencias (+1 tap), toast tapando "Tu pedido"/"Seguir comprando" 2,2 s. Convierte igual: el camino corto es realmente corto.

### 5 · Desconfiado, necesita señales antes de pagar
- Suma: dirección real, "TABA no necesita tu DNI", "Tu pedido está protegido", edad para alcohol, sin promesas infladas, resumen exacto antes de confirmar. 🔴 Resta y puede frenarlo: sin horarios, sin WhatsApp, zona "a confirmar", pago solo "a coordinar" — cinco filas "a confirmar" seguidas en Información del local. Su abandono es el costo más directo de los datos no publicados.

### 6 · Entra desde un link de producto
- No existe URL de producto (la ficha es modal y no cambia el hash): el mejor link posible es `#catalog` (funciona, verificado). 🟡 Malinterpreta: espera aterrizar en la botella y cae en la góndola. Si el link viene de la historia JD, la decepción es doble (marca inexistente en catálogo). Reduce conversión: no hay pieza compartible por WhatsApp — el canal de venta natural de un barrio.

### 7 · Encuentra un producto sin precio
- 🟢 Entiende el estado (copy claro, sin "$ 0") y puede guardarlo. 🟡 Duda sin respuesta: "¿cuándo?"; puede malinterpretar agotado vs sin precio publicado. ♻️ Favoritos como memoria. Reduce conversión: ninguna acción comercial posible; aumenta confianza: que nadie le inventó un precio.

---

## Síntesis

El tronco **entrada → producto comprable → carrito → checkout → confirmación** está 🟢 de punta a punta: la fricción medible se concentra en (a) las **puertas que prometen y no despachan** (P1-1, P1-2), (b) el **peaje del modal** en el tap de pagar (P1-3), y (c) el **75,6 % del catálogo sin precio**, que convierte medio descubrimiento en vidriera muerta y es la única palanca que no se arregla con código.
