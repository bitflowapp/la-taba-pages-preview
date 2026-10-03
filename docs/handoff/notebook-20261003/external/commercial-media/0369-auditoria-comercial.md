# Auditoría comercial — Storefront TABA2 / La Taba 2

| | |
|---|---|
| **Fecha** | 2026-08-05 |
| **Worktree** | `C:\1212\la-taba2-mobile-design-integration` |
| **Rama** | `integration/taba2-mobile-design-review` |
| **HEAD** | `08bb17a0a17d7b86847b9a782f35b23037073094` (verificado, working tree limpio antes y después) |
| **Modo auditado** | `?reset=1&demo=1` servido sin caché en `http://127.0.0.1:8365` (relay propio del repo) |
| **Viewports** | 320×568 · 390×844 · 432×960 (lógico Moto G15) · 1280×900 |
| **Método** | Chromium headless (Playwright del repo), 1 instancia, contextos frescos, SW bloqueado (salvo prueba offline dedicada), `isMobile`+`hasTouch`, es-AR. Dos pases + inventario estático de código. **Cero modificaciones al repo.** |
| **Evidencia** | 60 capturas en `capturas-anotadas\` (ver `INDEX.md`) + mediciones JSON + referencias `archivo:línea` |

---

## 1. Veredicto ejecutivo

**El storefront está comercialmente sano y técnicamente impecable en el flujo que hoy puede vender: cero P0.** Un cliente entra, entiende en menos de cinco segundos que La Taba 2 vende bebidas en Mendoza 827 (Neuquén), encuentra una gaseosa o una cerveza, y confirma un pedido real de demo en 4 toques, con total correcto ($ envío 1.990 / retiro $0), mínimo de delivery explicado, edad solo si hay alcohol, protección de doble envío y un seguimiento honesto que persiste al recargar. En dos pases completos: **0 errores de consola, 0 requests fallidos, 0 px de overflow en los cuatro anchos.**

Lo que frena la conversión no es el diseño: son **tres fugas comerciales concretas (P1)** — un "Ver todos" que muere en "0 productos", puertas editoriales (2 banners + 1 historia) que desembocan en rubros donde no se puede comprar nada, y un modal de sugerencias que se antepone al tap de pagar incluso con el pedido inválido — más **la realidad del catálogo: 62 de 82 productos (75,6 %) sin precio publicado**, que es un gate del negocio, no del producto.

**Recomendación final: A — IMPLEMENTAR P0/P1** (tres arreglos chicos y de bajo riesgo; el plan está en `plan-de-cierre.md`). La carga de precios y datos del local corre en paralelo como decisión comercial ya documentada por el propio repo (`docs/final-commercial-release/remaining-external-data.md`).

---

## 2. ¿Parece un negocio real?

**Sí.** Señales medidas:

- Identidad inequívoca al abrir: emblema con aro, "¡Bienvenido a **La Taba 2**!", "Tienda de bebidas · Mendoza 827, Neuquén", chip "Pedidos disponibles" (captura `390-01-home-fold`).
- **Ningún rótulo técnico ni de preview** en la superficie del cliente con `?demo=1`: no existe "PREVIEW INTERNA" (retirada documentada en `styles/storefront.css:640-641`), no hay "sandbox", "fixture" ni "demo" visibles; el PIN admin **no está en el DOM** del cliente (verificado en vivo: `[data-admin-pin]` inexistente).
- Productos reales de consumo argentino con packshots limpios sobre plato blanco, precios plausibles 2026 ($2.925–$19.999), marcas correctas.
- Copy rioplatense natural en todo el recorrido ("Sumá un producto…", "Te esperamos en el mostrador", "TABA no necesita tu DNI").
- Post-venta de comercio real: "Tenés un pedido en curso · LT-0002 · Recibido · tocá para seguirlo" en home y carrito, persistente tras recargar.

Lo único que delata etapa temprana no es estético sino de **datos**: en Perfil → Información del local, 5 de 9 filas dicen "a confirmar/a coordinar con el local" (horarios, zona, WhatsApp, medios de pago, retiro) — honesto, pero un cliente desconfiado lo lee como "todavía no abrió del todo".

## 3. ¿Está cerca de vender?

**El producto sí; el negocio todavía debe publicar datos.** Distinción importante:

- **Camino de compra (producto):** completo y sólido. Con los 20 productos comprables el ciclo entra-elige-paga-sigue funciona sin fricción técnica alguna. Tras la Tanda 1 del plan, la demo queda lista para mostrarse a un cliente real sin vergüenza.
- **Cobertura comercial (negocio):** 20/82 productos con precio (gaseosas 7, cervezas 7, energizantes 4, mixers 2). **Diez rubros enteros — vinos, aguas, aperitivos, fernet, gin, saborizadas, isotónicas, complementos, espumantes, whisky (30 productos) — no tienen ni un solo comprable.** Quien busca "fernet" (la búsqueda argentina por excelencia en una tienda de bebidas) recibe 3 productos "Precio próximamente" y ninguna salida (captura `390-04-busqueda-fernet`). Eso no se arregla con diseño: se arregla cargando precios — gate humano ya listado en `remaining-external-data.md:11-18` — y, mientras tanto, no construyendo vidriera editorial hacia esos rubros (P1-2).

---

## 4. Fortalezas (medidas, no impresiones)

1. **Sistema de superficie ejemplar.** Shell grafito + contenido crema, un radio, una sombra, en las 7 vistas. Contraste computado sobre color realmente pintado: **0 nodos de texto por debajo de 4,5:1** en home, catálogo y carrito a 320/390/432.
2. **Higiene técnica total.** 0 errores de consola, 0 `pageerror`, 0 requests fallidos ni 4xx, overflow horizontal 0 px en los 4 anchos, en ~40 estados capturados.
3. **Primer producto comprable sobre el pliegue** a 390 (botón Agregar a 703/844) y 432 (706/960), con precio y CTA. La promesa del contrato de marca ("el primer producto cae sobre el pliegue" en Moto G15) **se cumple** en el ancho del dispositivo objetivo.
4. **Carrito y checkout de dos decisiones.** Perfil sembrado ("Tus datos" + direcciones tarjeta con radio), modalidad Delivery/Retiro con totales correctos e inmediatos ($ 1.990 / $ 0), "Pedido mínimo delivery" visible como fila informativa y como progreso, campo de vuelto solo con efectivo, edad solo con alcohol (verificado en ambos sentidos), `Confirmar pedido` → "Creando pedido…" con guarda anti-reentrada: **clicks repetidos produjeron exactamente un pedido** (LT-0002).
5. **Post-compra honesto y persistente.** Tracking sin ETA inventada ("El pedido sigue en el local…", "Repartidor aún no asignado"), resumen completo (ítems, envío, "Pago: Efectivo", total, referencia), banner de pedido en curso en home + estado vacío del carrito, y todo sobrevive al reload sin `reset` (captura `390-60-persistencia`).
6. **Estados no felices cuidados.** Búsqueda sin resultados ("No encontramos «zzqqxx» / Probá con la marca o la presentación"), favoritos vacíos, carrito vacío, seguimiento vacío: todos con CTA de retorno. **Offline real con SW: la app recarga sin red, muestra el catálogo cacheado y el banner "Sin conexión"** (captura `390-31-offline-reload`).
7. **Accesibilidad por encima de la media.** Objetivos táctiles: **0 controles < 44 px** en las vistas del cliente a 320/390/432 (medición exhaustiva de botones/links/inputs visibles). Inputs de búsqueda a 16 px (sin zoom iOS). `aria-current` en nav y categorías de home, `aria-pressed` en favoritos y chips de catálogo, diálogos nativos con foco atrapado y **retorno de foco verificado** (ficha → disparador; historias → aro). `prefers-reduced-motion` detiene el aro (medido `animationName: none`).
8. **Honestidad comercial absoluta.** Sin precio → "Precio próximamente" + "Este producto todavía no está disponible para compra" + botón deshabilitado o "Ver detalle"; 0 promociones pintadas (las 2 semillas están inactivas y no aprobadas); ningún descuento, ETA, stock ni reputación inventados en todo el recorrido.

---

## 5. Hallazgos

### P0 — bloquean comprar

**Ninguno.** Se recorrió compra completa (delivery y retiro, con y sin alcohol, bajo y sobre mínimo, doble submit, reload, offline) en 320/390/432/1280 sin encontrar ningún bloqueo, rotura de layout ni error de runtime.

---

### P1-1 · "Ver todos" de Destacados muere en "0 productos en Todos"

| Campo | Detalle |
|---|---|
| Pantalla / estado | Home → sección **Destacados** (primer bloque comerciable) → CTA "Ver todos" |
| Ancho | Reproducido a 390 (aplica a todos) |
| Elemento exacto | `index.html:294` — botón "Ver todos" con `data-category-id="popular"` |
| Evidencia | Captura `390-42-destacados-ver-todos`: título "Todos", contador "**0 productos en Todos**", tarjeta "No hay productos disponibles en esta categoría". Causa: ningún producto del dataset tiene `popular: true` (grep sin resultados en los dos archivos de datos); el filtro devuelve vacío (`js/ui.js:1517-1518`) y el título cae al fallback "Todos" (`js/ui.js:1592`) |
| Problema | La CTA principal de la primera sección comercial de la home lleva a una pantalla que afirma que la tienda **no tiene productos**, con un título ("Todos") que lo generaliza a todo el catálogo real de 81 ítems visibles |
| Impacto comercial | Quien quiere "ver más de lo destacado" — el comprador más caliente — aterriza en una tienda aparentemente vacía. Abandono directo y daño de confianza ("esto está roto/cerrado") |
| Recomendación | Apuntar la CTA a `all` (los 20 comprables aparecen primero por orden Recomendados) **o** materializar "Destacados" como filtro real (los mismos 8 SKUs del rail). Cualquiera de las dos, nunca `popular` sin datos |
| Esfuerzo | XS (1 línea de HTML; opcionalmente título) |
| Riesgo técnico | Nulo. Actualizar el spec de contrato si fija ese destino |
| Preservar | El rail Destacados en sí (contenido y orden son correctos); el estado vacío genérico (está bien escrito para categorías legítimamente vacías) |

### P1-2 · Puertas editoriales que desembocan en rubros sin nada comprable

| Campo | Detalle |
|---|---|
| Pantalla / estado | Home (banners editoriales) e Historias |
| Ancho | Todos |
| Elemento exacto | Banner "SELECCIÓN PREMIUM / El mejor whisky / Explorar whisky →" y banner "CLÁSICO ARGENTINO / Fernet y amargos / Explorar fernet y amargos →" (elegibilidad en `js/ui.js:741-778`); historia "Jack Daniel's en la barra" → CTA "Ver categoría" → `whisky` (`js/preview-stories-data.js:64-77`) |
| Evidencia | Capturas `390-41-whisky-desde-historia` y `390-02-home-full`. Whisky = **1 producto, "Precio próximamente", sin stock, y ni siquiera es Jack Daniel's** (es Johnnie Walker Red, `js/taba2-commercial-pending-data.js:2195`); fernet = 3 productos, todos pendientes. El contador dice "1 producto en Whisky" y la única tarjeta no se puede comprar |
| Problema | El hero sí exige categoría con producto **comprable** (fail-closed, contrato §6), y la fila de categorías de home también (`js/ui.js:997-1016`); banners e historias solo exigen que el destino **exista**. Tres piezas premium de la vidriera invitan a pasillos vacíos; la historia además promete una marca que el catálogo no tiene |
| Impacto comercial | La vidriera editorial — el recurso de venta más caro de la home — produce decepción en vez de ticket. Perfil 2 (explorador de ofertas) y perfil 6 (llega por una marca) tocan, no pueden comprar, y no reciben ninguna salida |
| Recomendación | Unificar criterio: banner/historia se pinta **solo si su destino tiene al menos un producto comprable** (mismo predicado del hero y de la fila de categorías). Con el catálogo actual quedan la puerta de marca Heineken (destino con comprable: lata 473 $ 3.900) y las historias de cervezas/energizantes/mixers; whisky, fernet y la historia JD se apagan solas y **reaparecen sin tocar código el día que el local publique esos precios** — exactamente la filosofía ya documentada para Andes Origen |
| Esfuerzo | S (una condición en la elegibilidad de banners y un filtro en `getHomeStories`; ajustar invariantes del spec `taba2-brand-home`) |
| Riesgo técnico | Bajo. La suite ya verifica "ningún banner sin producto en su destino"; se endurece el predicado |
| Preservar | La composición copy-izquierda/foto-derecha con `focus` por pieza; el banner de marca Heineken; el sistema de historias completo (aro, estados, retorno de foco) |

### P1-3 · El modal "ANTES DE PAGAR" se antepone al tap de pagar — incluso con el pedido inválido — y duplica un rail ya visible

| Campo | Detalle |
|---|---|
| Pantalla / estado | Carrito → Confirmar pedido (primer tap de la sesión, cuando alguna regla de sugerencia aplica; p. ej. cerveza sin acompañamiento sin alcohol) |
| Ancho | Reproducido a 390; a 320/432 con carrito de gaseosas la regla no aplica y el tap confirma directo (evidencia de que es condicional) |
| Elemento exacto | Compuerta en `js/app.js:1437-1439` (corre **antes** de `validateCartForCheckout`); modal `checkout-suggestions-modal` (`js/ui.js:2190-2200`); mismas sugerencias que el rail "RECOMENDADOS PARA VOS" ya renderizado arriba en el propio carrito (`js/ui.js:2170-2174`) |
| Evidencia | Capturas `390-50-modal-sugerencias` y `390-51-error-minimo`: con carrito de **$ 3.900 (bajo el mínimo de $ 5.000)**, el primer tap abre el modal ofreciendo packs de **$ 19.999**; recién al continuar aparece el error real "Te faltan $ 1.100…". Secuencia: upsell → error |
| Problema | Interstitial en el momento de mayor intención de pago; ofrece producto **antes** de decir que el pedido no puede confirmarse; sugiere ítems de $ 17.100–19.999 para una brecha de $ 1.100 (existe Speed $ 2.925); y repite uno-a-uno el rail visible en la misma pantalla |
| Impacto comercial | Impuesto de un tap a cada primera confirmación elegible (perfil 4, apurado a una mano) y riesgo de lectura "me quieren vender más caro justo cuando voy a pagar" (perfil 5, desconfiado). El orden upsell-antes-que-error es el tipo de detalle que rompe confianza en el paso más delicado |
| Recomendación | (a) Validar **antes** de sugerir: si el checkout no pasa, mostrar el error, nunca el modal. (b) Dado que el rail ya cumple la función a la vista, degradar el modal a: solo con pedido válido, solo si el rail no fue interactuado, y con ítems ordenados por precio ascendente — o directamente eliminarlo y conservar el rail. Mantener "Continuar sin agregar" como está (claro y honesto) |
| Esfuerzo | S (mover la compuerta después de la validación; orden/condición de sugerencias) |
| Riesgo técnico | Bajo; existe marcador de sesión y camino `requestSubmit()` ya probado |
| Preservar | El rail "RECOMENDADOS PARA VOS" en el carrito (bien ubicado, no bloquea); la regla "acompañamientos sin alcohol" como concepto |

---

### P2 (9)

**P2-1 · El aviso de mínimo desaparece tras limpiar un error inline.**
Carrito/checkout · 390 · `[data-checkout-warning]`. Bug verificado en vivo: `clearCheckoutInlineError` pone la **propiedad** `hidden = true` (`js/app.js:879`) pero el render vivo solo alterna la **clase** `hidden` (`js/ui.js:2308`). Secuencia reproducida: bajo mínimo → warning visible → submit → error → cambiar forma de pago → warning `hidden=true` con el carrito aún en $ 3.900 (JSON `bug aviso desaparece`; capturas `390-49`→`390-52`). El cliente queda bajo mínimo con botón habilitado y sin guía visible (solo la fila muted del resumen); el error reaparece recién al re-enviar. **Fix XS:** limpiar/restaurar por el mismo mecanismo (propiedad o clase, uno solo). Riesgo nulo. Preservar el doble canal aviso-vivo + error-con-foco, que está bien pensado.

**P2-2 · A 320×568 no hay nada comprable sobre el pliegue.**
Home · 320 · primer `[data-add-product]` a **686 px** de 568 (medido; capturas `320-01` vs `390-01`). El pliegue muestra identidad, historias, buscador y categorías — ruta a compra, sí; producto y precio, no. **Fix S:** compactación vertical solo < 360 px (hero/bienvenida/paddings; hay media queries a 360/560). Riesgo bajo (re-verificar contrato de pliegue del spec en 432, que hoy cumple con 254 px de margen). Preservar el orden de bloques del contrato §2b — no quitar historias ni hero.

**P2-3 · Filtros con valores crudos y capacidades desordenadas.**
Catálogo → Filtros · todos los anchos · `copyFilters` medido: Presentación = "**botella / botella-pet / lata / unidad**" (slugs con guion, minúscula); Capacidad = "1 L, 1500 ml, 2 L, 2,25 L, 200 ml, 250 ml…" (orden alfabético, no volumétrico; mezcla "1500 ml"/"1,5 L"/"2,25 L"; incluye "4 kg" sin contexto). Captura `390-08-filtros`. Un vecino no habla en slugs. **Fix S:** mapa de etiquetas de presentación (Botella, Botella PET, Lata, Unidad), orden numérico por ml normalizados, y unidad de display consistente (≥1000 ml → "1,5 L"). Solo presentación — **no tocar datos del catálogo**. Riesgo bajo.

**P2-4 · Tres nombres conviven frente al cliente: La Taba 2, TABA y TABA2.**
Perfil/tracking/chrome · todos · "**TABA no necesita tu DNI**" (`js/customer-profile-view.js:413`), "**Entrega TABA2**" y "**Rider TABA2**" (`js/ui.js:2684-2711`), "Buscar en TABA2", "Instalar TABA2" (`index.html:106,140`) versus "La Taba 2" en header/hero/nav. Capturas `390-61`, `390-56`. Para el cliente de barrio, la marca es el local; el nombre de plataforma en copys de confianza (DNI, entrega) diluye cercanía. **Fix S:** política de nombres — `businessName` en todo copy dirigido al cliente; "TABA2" queda en título/manifiesto/superficies de plataforma. Riesgo bajo (strings). Preservar la distinción producto/local del contrato de marca (§2), que ya existe: solo falta aplicarla al copy.

**P2-5 · "Destacados" lleva de subtítulo "Selección del local", que es el nombre de otra sección.**
Home · todos · `js/ui.js:1085` vs `index.html:354-363` ("Selección del local / Bodega y destilados"). Captura `390-01-home-fold` + `390-02-home-full`. Dos bloques distintos comparten nombre: el primero comprable, el último editorial-pendiente. **Fix XS:** subtítulo distinto para Destacados (p. ej. "Los más pedidos del local") o quitarlo. Riesgo nulo. Preservar la sección final "Selección del local" tal cual: su tratamiento honesto de rubros sin precio es correcto y está bien resuelto.

**P2-6 · Las recomendaciones ofrecen packs de $ 17.100–19.999 para carritos y brechas chicas.**
Carrito (rail y modal) · 390 · `js/core/cart-recommendations.js:31-51`. Medido: carrito $ 3.900 y brecha de mínimo $ 1.100 → sugerencias arrancan en $ 17.100 (capturas `390-50`, JSON `doble agregar`). Existen comprables de $ 2.925–3.900 que cierran la brecha. **Fix S:** ordenar candidatos por precio ascendente y, si hay brecha de mínimo activa, priorizar ítems que la cierren. Riesgo bajo. Preservar la regla "sin alcohol para acompañar" como criterio de selección.

**P2-7 · Foco de teclado invisible en Delivery/Retiro.**
Checkout · todos · radios `deliveryMode` con `opacity:0` posicionados (`styles/checkout.css:419-422`) sin regla `:focus-visible` en el `span` visible (sí existe la equivalente para variantes de producto en `:337-340`). Medido en vivo: elemento enfocado `deliveryMode=pickup`, outline solid/2px, **opacity 0** → nada visible (captura `390-55`). WCAG 2.4.7. **Fix XS:** replicar la regla de variantes. Riesgo nulo.

**P2-8 · Los errores de checkout marcan `aria-invalid`/`aria-describedby` en inputs `hidden`.**
Checkout · todos · mapeo `js/app.js:850-857` resuelve a `customerName`/`customerPhone`/`customerStreetAddress`/`customerNeighborhood`, todos `type="hidden"` (`index.html:505-511`); el foco cae siempre al cuadro genérico (`js/app.js:912-913`, verificado: `focused: DIV.warning-box`). En demo casi no se ve (perfil sembrado); **en producción, con perfil vacío, será el camino estándar del primer error**. **Fix M:** mapear a los controles perceptibles reales (tarjeta "Tus datos"/CTA "Completar Perfil", radiogroup de direcciones, checkbox de edad). Riesgo medio (camino crítico → cubrir con spec dedicado). Preservar el patrón error-único-con-foco.

**P2-9 · CTA de historias genérica y sin cierre por backdrop.**
Historias · todos · etiqueta fija "Ver categoría" (`js/core/stories.js:36`) cuando el destino es concreto ("Ver cervezas" vende más que "Ver categoría"); el visor cierra por × y Esc pero no por tap en el fondo (los demás modales del cliente sí: `js/app.js:1598-1622`). Captura `390-03-historias`. **Fix XS/S:** interpolar el nombre del destino en la etiqueta; agregar cierre por backdrop del visor. Riesgo bajo. Preservar retorno de foco al aro (medido y correcto).

---

### P3 (preferencias, no esenciales)

- Toast superior tapa ~2,2 s el título/acciones al entrar al carrito ("Sprite agregado…" sobre "Tu pedido", capturas `320-05`, `432-06`).
- Anillo de foco azul del user-agent en los inputs de búsqueda conviviendo con el outline de marca (captura `390-06`).
- "Última actualización hace 0 s" congelado hasta el próximo tick del minutero.
- Buscador desktop: input de 42 px y sin nombre accesible propio (`index.html:106-111`) — único gap medido a 1280.
- Microcopys de 9–10 px en badges (`styles/responsive.css:284,917`; `styles/common.css:179`) — legibles en DPR alto, mejorables.

---

## 6. Qué NO debe tocarse

1. **Hero "Bien fría, como tiene que ser"** — aprobado; no se encontró contradicción comercial en el flujo completo. La regla del prompt queda cumplida: no se re-litiga.
2. **Paleta y tokens de superficie** (grafito + crema + rojo TABA + dorado moderado): contraste medido sin fallos; identidad consistente en 7 vistas.
3. **Emblema y encabezado en dos filas + acceso a historias** (aro 72 px estable, estados unseen/seen, reduced-motion).
4. **Orden de la home del contrato §2b** (comprable arriba, editorial abajo, "Selección del local" al final con estado honesto).
5. **Modelo de checkout perfil-primero** (dos decisiones, direcciones tarjeta, "Editar en Perfil", "Volver al pedido"): es la mejor pieza de conversión del producto.
6. **Tratamiento "Precio próximamente"** en card/ficha (honesto, sin "$ 0", con "Ver detalle"/"Guardar para después").
7. **Tracking honesto** (sin ETA/ubicación inventadas; "El pedido sigue en el local") y su persistencia + banner de pedido en curso.
8. **Bottom nav de 5 ítems con emblema central** (todas ≥ 44 px, `aria-current`, se oculta en vistas operativas).
9. **Cards crema y densidad de carruseles** de la home (8 comprables en el rail Destacados, rails por rubro con 4+2 packs).
10. **Estados vacíos** existentes (búsqueda/favoritos/carrito/seguimiento) — solo se corrige a dónde llevan las puertas, no los estados.

## 7. Riesgos de sobre-rediseño

- **Convertir honestidad en promesa.** Cualquier "te avisamos cuando esté", "llega en X min", "oferta" o precio tachado sin backend/aprobación rompe el contrato fail-closed que es la mayor virtud del producto. Prohibido inventar para "completar" (regla ya escrita en `README.md:135-136`).
- **Perseguir el pliegue de 320 sacrificando el orden aprobado.** El contrato de bloques está medido en el dispositivo objetivo (432); compactar sí, reordenar o quitar historias/hero, no.
- **Rehacer los filtros como UI custom.** El `details` nativo funciona, es estable y accesible en lo esencial; el problema es de etiquetas y orden, no de arquitectura. (Su falta de cierre por backdrop está incluso documentada en el CSS.)
- **Agregar campos visibles al checkout.** La ausencia de formulario largo ES la ventaja competitiva; los datos viven en Perfil. Resistir cualquier "agreguemos nombre y teléfono acá".
- **Tocar imágenes/identidad/contratos en esta fase** — fuera de alcance por instrucción; nada de lo hallado lo requiere.
- **Inflar el backlog.** Los tres P1 son quirúrgicos. El salto real de conversión (75 % del catálogo) no se diseña: se carga.

## 8. Limitaciones de esta auditoría

- Solo Chromium (WebKit/Firefox tienen fallos conocidos y documentados propios del commit base; no se re-midieron).
- No se usó el Moto G15 físico (prohibido en esta fase; el 432×960 lógico lo aproxima).
- No se recorrió el primer pedido con **perfil vacío** (la demo siembra "Cliente Demo"); el camino "Completá tu perfil para continuar → Perfil → Volver al pedido" existe en código (`js/customer-delivery.js:664-668`, `js/customer-profile-view.js:639-643`) pero no fue ejercitado visualmente — pendiente para cuando se audite el modo producción.
- Zoom de texto/página y lectores de pantalla reales no probados (solo auditoría ARIA/DOM programática).
- El lock de cómputo pesado no pudo crearse: la ACL de la raíz `D:\` (`BUILTIN\Usuarios: RX`) impide crear `D:\1212_claude-locks` a cualquier proceso no elevado. Mitigación aplicada: verificación previa de ausencia de Playwright/Chromium en ejecución, 1 sola instancia, puerto dedicado 8365, server detenido al finalizar.
