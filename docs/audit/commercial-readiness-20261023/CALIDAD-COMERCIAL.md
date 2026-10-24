# Calidad comercial: la tienda y el Panel vistos como los va a usar un negocio con compradores reales

24/10/2026. Mediciones, no opiniones. Dos superficies: el recorrido de compra en **modo demostración** (la misma interfaz, sin red) en tres teléfonos, y el **preview de QA** v161 con backend real (dinero ficticio). Herramientas reutilizables: `scripts/audit/mobile-commerce-audit.mjs`, `scripts/recovery/verify-preview-panel.mjs`, `scripts/recovery/verify-preview-operations.mjs`. Evidencia en [`calidad-movil/`](calidad-movil/) y [`despliegue-qa/`](despliegue-qa/).

## 1. Recorrido de compra en el teléfono (Android 360×740, iPhone 390×844, chico 320×568)

Inicio → catálogo → agregar → carrito con datos de entrega → confirmar vacío → seguimiento → panel.

| Medición | Resultado |
|---|---|
| Desborde horizontal | 0 px en todas las pantallas |
| Desplazamiento acumulado del diseño (CLS) | 0 (el salto de +451 px del inicio medido en julio ya no está) |
| Errores de consola | 0 |
| Controles sin nombre accesible / campos sin etiqueta / imágenes sin `alt` | 0 / 0 / 0 |
| Precios visibles sin desplazar en el catálogo | 2 (360 y 390), 1 (320) — en julio eran 0 |
| Aviso «PREVIEW INTERNA» incondicional (julio) | ya no aparece |
| Confirmar con el formulario vacío | no sale del checkout, marca 2 campos inválidos y **mueve el foco al resumen de errores** («Te faltan $ … para el mínimo de delivery. También podés elegir retiro en local.») |
| Objetivos táctiles de menos de 44 px | 1–2 en el catálogo: el enlace del nombre del producto mide 20–39 px de alto (la tarjeta tiene además la foto y el botón «Agregar» de tamaño completo); 3 enlaces de atribución del mapa en 320 px. **Menor**, no bloquea |

## 2. Preview de QA con backend real (v161, `566c675d`)

| Verificación | Resultado |
|---|---|
| Publicación (`verify-preview-deployment`) | cada archivo idéntico al artefacto; commit, runtime y service worker coinciden; puerta de acceso con sesión segura; `noindex` |
| Panel de pagos (`verify-preview-panel`, 1100 px) | **19/19**: cada pago muestra el estado que dice el servidor (10/10), cobros manuales y online en la misma pantalla, sin diálogos ni errores de consola |
| Centro de operación en el teléfono (`verify-preview-operations`, 390 px) | compras abandonadas como información; «Hay 1 cosa esperando una acción — Podés seguir vendiendo»; el pedido reembolsado pide cancelarse y no cuenta como nuevo ni demorado; cancelación con motivo desde Pedidos → stock repuesto una vez → alerta resuelta; final «La operación está al día» |

## 3. Defectos encontrados y corregidos en esta etapa

| Defecto | Efecto para el comercio | Corrección |
|---|---|---|
| Toda compra abandonada en Mercado Pago era una alerta CRÍTICA durante ~26 h | el Panel decía «frená y resolvé antes de seguir cobrando» por algo normal | gravedad según la verificación (`ALERTAS-PREEXISTENTES.md`) |
| Pedido con el pago devuelto: la alerta pedía aceptarlo, las tarjetas lo contaban como nuevo y demorado | órdenes contradictorias; un pedido sin cobro quedaba abierto | alerta propia + exclusiones (dos migraciones) |
| El Panel juzgaba «pago devuelto» por la etiqueta y no por importes | tarjeta trabada tras devolver un pago en revisión: sin «Cancelar», con un «Avanzar» que la base rechaza | mismo criterio que la base |
| Tres alertas de dinero sin texto propio | «algo necesita que una persona lo mire» para un pago sin pedido o el procesamiento de pagos frenado | textos con qué pasó, qué se conserva, riesgo y qué hacer |
| El verificador del Panel contaba una devolución ya registrada como «dinero sin resolver» | falso rojo en la verificación | misma regla que el Panel |

## 4. Lo que falta para comprar de verdad (no es código)

- **Catálogo real**: precios, stock, presentaciones y **fotos con derechos** validados por Walter (`catalog/opening/OWNER-INPUT.md`). La tienda pública no puede mostrar datos de demostración. Hoy el catálogo recuperado son 72 productos privados sin precios vigentes.
- **Datos del comercio**: horario, zona y tarifa de envío, mínimo de delivery, dirección de retiro, contacto (`verificar-listo-para-vender.mjs` los exige antes de abrir; un valor por omisión que enciende una venta no es una configuración).
- **Prueba física** en los teléfonos de Walter y del repartidor (Safari/iPhone real incluido): no se puede reemplazar con un emulador.
- `la-taba.pages.dev` hoy muestra una tienda contra una base borrada: no difundir ningún enlace hasta publicar el sitio nuevo (`ENTORNOS.md` §7).
