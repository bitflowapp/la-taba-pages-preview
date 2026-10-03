# Índice de capturas anotadas — Auditoría comercial TABA2

Chromium headless, demo local sin caché (`?reset=1&demo=1`, servidor propio del repo en `127.0.0.1:8365`), contextos frescos por ancho, es-AR. Prefijo del archivo = ancho CSS. Todas las capturas registraron **overflow horizontal 0 px**. Etiquetas P1-x/P2-x remiten a `../auditoria-comercial.md`.

## Pase 1 · Primera impresión y núcleo por ancho

| Captura | Qué evidencia |
|---|---|
| `390-01-home-fold` | Pliegue a 390: identidad completa + historias + buscador + categorías + **producto con precio y Agregar visibles** (Agregar a 703/844). Nota P2-5: "Destacados" subtitulado "Selección del local". |
| `390-02-home-full` | Vidriera completa: Destacados → hero "Bien fría…" → rails por rubro → banners "El mejor whisky" / "Fernet y amargos" / "Heineken" (P1-2) → "Selección del local" honesta → CTA final. |
| `320-01-home-fold` | Pliegue a 320×568: marca/buscador/categorías sí, **ningún producto ni precio** (primer Agregar a 686 px) — P2-2. |
| `320-02-home-full` / `432-02-home-full` / `1280-02-home-full` | Misma vidriera íntegra en los otros anchos (paridad, sin roturas). |
| `432-01-home-fold` | Pliegue en el ancho lógico del Moto G15 (960): primer producto cómodo sobre el pliegue (706 px). |
| `1280-01-home` | Desktop: nav propia (Inicio/Categorías/Pedidos/Seguir/Cuenta), buscador en topbar, grilla 4-up. Sin roturas (desktop no prioritario). |
| `390-03-historias` | Visor de historias: foto full-bleed, progreso ×4, CTA roja "Ver categoría" (genérica — P2-9), Anterior/Siguiente. |
| `390-04-busqueda-fernet` | **Búsqueda "fernet": 3 resultados, los 3 "Precio próximamente"** — muro sin salida comercial (contexto de P1-2 / gate de precios). |
| `390-05-busqueda-sin-resultados` | "No encontramos «zzqqxx» / Probá con la marca o la presentación" + salidas. Estado ejemplar. |
| `390-06-catalogo` | Catálogo "Todos · 81 productos": cards crema con marca/nombre/presentación/precio/Agregar; nav inferior con estado activo. |
| `390-07-catalogo-cervezas` | Filtro por categoría activo (chip `aria-pressed`), 7 cervezas comprables primero. |
| `390-08-filtros` | Sheet de filtros: potente pero con **slugs "botella-pet"** y capacidades desordenadas — P2-3. |
| `390-09-solo-sin-precio` | Filtro Precio="Precio próximamente": el tratamiento honesto en masa (cards sin CTA de compra). |
| `320-03/432-03/1280-03-catalogo` | Catálogo en los demás anchos: grilla 2-up/2-up/4-up sin overflow. |
| `320-04/432-04/1280-04-producto` | Ficha modal de producto con precio: presentación, disponibilidad, cantidad, observación, edad, Agregar. |
| `320-05-carrito` / `432-05-carrito` | Carrito con 2 ítems: stepper (papelera a qty 1), línea por ítem. Toast "Sprite agregado…" **tapando el título** ~2,2 s (P3). |
| `320-06-checkout` / `432-06-checkout` / `1280-05/06` | Checkout: Delivery/Retiro, "Tus datos" precargados, direcciones tarjeta con radio, "Forma de pago: A coordinar con el local". |
| `320-07-checkout-errores` / `432-07-checkout-errores` | **Primer tap de Confirmar con carrito de gaseosas → pedido confirmado directo** (la regla de sugerencias no aplica sin alcohol): pantalla de tracking + toast. Evidencia de fricción mínima del camino corto. |
| `432-08-tras-doble-submit` | Tras clicks repetidos en Confirmar: **un solo pedido** (LT-0002 · 2 productos · $36.190). Guarda anti-reentrada verificada. |
| `320-09/432-09-perfil` / `1280-07-perfil` | Perfil en anchos restantes. |
| `390-22-checkout-completo` | ⚠️ Artefacto del pase 1: el sheet de filtros quedó abierto y bloqueó el flujo (los pasos de carrito/checkout de 390 se rehicieron en el pase 2). Documenta de paso que el sheet **no cierra por tap afuera**. |
| `390-24-seguimiento` | Estado vacío de Seguimiento: "Todavía no hay un pedido en curso" + CTA. (Pase 1, sin pedido creado aún.) |
| `390-25/26` | Home y reload del pase 1 (sin pedido): estado base sin banner de pedido. |
| `390-27/28-perfil(-full)` | Perfil completo: Cliente Demo, 4 direcciones tarjeta, "TABA no necesita tu DNI" (P2-4), "Información del local". |
| `390-29-deeplink-catalogo` | Deep link `?demo=1#catalog` aterriza en catálogo (funciona). |
| `390-30-foco-tab5` | Foco visible (outline 3 px) recorriendo el home por teclado. |
| `390-31-offline-reload` | **Recarga sin red con SW activo: la app renderiza el catálogo cacheado + banner "Sin conexión"**. PWA offline real. |

## Pase 2 · Flujo transaccional y callejones (390×844)

| Captura | Qué evidencia |
|---|---|
| `390-40-historia-jack-daniels` | Historia "Jack Daniel's en la barra" en el visor. |
| `390-41-whisky-desde-historia` | **P1-2:** su CTA aterriza en "1 producto en Whisky" — Johnnie Walker (otra marca), "Precio próximamente", incomprable. |
| `390-42-destacados-ver-todos` | **P1-1:** "Ver todos" de Destacados → "Todos / 0 productos / No hay productos disponibles en esta categoría". |
| `390-44-ficha-sin-precio` | Ficha de producto pendiente (Red Bull pack x4): honesto, "Guardar para después", sin puente comercial. |
| `390-45-favoritos-vacio` | Estado vacío de Favoritos con instrucción de uso. |
| `390-46-favoritos-con-item` | Favorito guardado listado en el filtro Favoritos (`aria-pressed` en la card). |
| `390-47-carrito-vacio` | "Tu pedido está vacío / Sumá un producto del catálogo…" + CTA. |
| `390-48-flotante-bajo-minimo` | Barra flotante "Ver carrito" con 1 ítem ($3.900). |
| `390-49-carrito-bajo-minimo` | Aviso vivo "**Te faltan $ 1.100** para llegar al pedido mínimo…" + resumen con fila "Pedido mínimo delivery $ 5.000". |
| `390-50-modal-sugerencias` | **P1-3:** primer tap de Confirmar (pedido inválido) → modal "ANTES DE PAGAR / Completá tu pedido" ofreciendo **packs de $ 19.999** para una brecha de $ 1.100. |
| `390-51-error-minimo` | Tras "Continuar sin agregar": recién ahí el error real del mínimo (foco al cuadro de aviso). |
| `390-52-aviso-desaparecido` | **P2-1:** tras cambiar la forma de pago, el aviso inline quedó `hidden=true` (la píldora negra visible es el toast transitorio de 2,2 s del intento fallido); bajo mínimo sin guía persistente. |
| `390-53-resumen-delivery` / `390-54-resumen-retiro` | Totales por modalidad: $7.800+$1.990=$9.790 vs Retiro $0=$7.800. Correctos e inmediatos. |
| `390-55-foco-radio-retiro` | **P2-7:** foco programático en el radio "Retiro" — elemento con `opacity:0`: **ningún indicador visible**. |
| `390-56-confirmacion-tracking` | Confirmación: "Tu pedido fue confirmado", timeline, "El pedido sigue en el local", "Repartidor aún no asignado", tarjeta LT-0002 con thumb y total, toast. |
| `390-57-detalles-pedido` | Detalle expandido del pedido: ítems, Subtotal/Envío, "Pago: Efectivo", Total, dirección y referencia. |
| `390-58-home-pedido-activo` | Banner en home: "Tenés un pedido en curso / LT-0002 · Recibido · tocá para seguirlo". |
| `390-59-carrito-vacio-pedido-curso` | Carrito vacío con tarjeta "Pedido en curso · LT-0002 · Ver seguimiento". |
| `390-60-persistencia` | Reload sin `reset`: el pedido en curso persiste; carrito en 0. |
| `390-61-perfil-info-local` | Perfil: direcciones con Editar/Eliminar/Usar esta, "Agregar nueva dirección", "TABA no necesita tu DNI" (P2-4), "Información del local" (5 de 9 filas "a confirmar"). |
| `390-62-perfil-editor` | Editor de datos personales del Perfil. |
| `390-63-stepper-en-catalogo` | Doble agregado del mismo producto → stepper inline en la card (qty 2, nunca línea duplicada). |
| `390-64-modal-vaciar` | Modal "Vaciar carrito" con copy no destructivo y doble salida. |

## Faltantes conocidos

`390-43` (ficha con precio a 390) no se generó — el paso se saltó por estado previo del catálogo; la misma ficha está capturada a 320/432/1280 (`*-04-producto`). Los números 390-10…21/23 del plan original del pase 1 no existen: esos pasos los bloqueó el sheet de filtros abierto (ver `390-22`) y se rehicieron como 390-44…64 en el pase 2.
