# TABA — Consistencia entre productos

Tres productos, un sistema: **catálogo cliente**, **panel del negocio**, **app Android del rider**.

## Principio

**Se comparte el lenguaje. No se comparte la forma.**
Cada producto se optimiza para su tarea: vender, operar bajo presión, moverse en la calle. Compartir densidad o navegación entre ellos es lo que produjo el panel de negocio actual — un escritorio comprimido dentro de un teléfono.

---

## Qué se comparte — obligatorio

| Elemento | Regla |
|---|---|
| **Color** | Misma paleta y mismos roles. El rojo `#d0000d` significa *acción primaria o marca* en los tres productos, siempre |
| **Tipografía** | Mismo stack de sistema y misma escala. Los tamaños concretos varían por densidad, no la escala |
| **Radios** | 6 / 10 / 14 / 18 / pill |
| **Elevación** | e1 / e2 / e3 |
| **Iconografía** | Una sola familia lineal, trazo 1,7–1,8, caja de 24. Sin emoji |
| **Estados** | `punto + texto` en los tres productos. Los mismos colores semánticos para los mismos significados |
| **Accesibilidad** | 44px mínimo, 16px en inputs, AA, foco visible, sin color como único canal |
| **Feedback** | Mismo patrón: cambio inmediato en la interfaz + confirmación persistente en el estado, no sólo un aviso efímero |
| **Vocabulario** | Tabla de abajo, sin excepciones |
| **Números** | `tabular-nums` para precios, totales, métricas, IDs, códigos y distancias |
| **Stack inferior** | Misma fórmula derivada; ningún literal |

## Qué NO se comparte — deliberadamente

| Elemento | Cliente | Negocio | Rider |
|---|---|---|---|
| **Densidad** | Generosa: el producto respira | Alta: máxima información por pantalla | Muy baja: una decisión por pantalla |
| **Navegación** | Bottom nav de 4 (Inicio·Catálogo·Seguir·Perfil) | Bottom nav de 4 (Pedidos·Riders·Local·Caja) en móvil; sidebar de 8 en escritorio | Stack lineal sin nav: el flujo manda |
| **Tarjeta** | `p-card` con packshot cuadrado | `o-card` con borde de estado y sin imagen | `r-jobcard` con dos direcciones y una acción |
| **Jerarquía** | Producto → precio → agregar | Urgencia → cliente → acción | Paso actual → acción |
| **Acción primaria** | Roja, en la tarjeta | **En tinta** en la cola (repetida), roja en el detalle (única) | Roja, 56px, siempre abajo |
| **Superficie** | Papel claro | Papel claro | Barra superior `ink-900` por legibilidad exterior |
| **Estructura** | Descubrimiento + grilla | Cola + detalle | Lineal por estado del pedido |
| **Entrada de texto** | Buscador libre | Buscador libre | **Casi nula**: teclado numérico propio, incidencias por lista |

---

## Vocabulario único

Un estado, un nombre, en las cuatro superficies (cliente, negocio, rider, seguimiento). **Cualquier otra forma es un error a corregir.**

### Estados del pedido

| Estado | Cliente ve | Negocio ve | Rider ve | Seguimiento |
|---|---|---|---|---|
| `confirmed` | **Confirmado** | **Nuevo** | — | **Confirmado** |
| `preparing` | **Preparando** | **Preparando** | — | **Preparando** |
| `ready` | **Listo** | **Listo** | **Listo para retirar** | **Listo** |
| `assigned` | **Preparando** | **Asignado** | **Asignado** | **Preparando** |
| `picked_up` | **En camino** | **Retirado** | **Retirado** | **En camino** |
| `on_the_way` | **En camino** | **En camino** | **En camino** | **En camino** |
| `arriving` | **Llegando** | **Llegando** | **Llegando** | **Llegando** |
| `delivered` | **Entregado** | **Entregado** | **Entregado** | **Entregado** |
| `cancelled` | **Cancelado** | **Cancelado** | **Cancelado** | **Cancelado** |
| `failed` | **No se pudo entregar** | **Fallido** | **Incidencia** | **No se pudo entregar** |

Nota deliberada: el cliente ve **Preparando** mientras el negocio ve **Asignado**. No es una inconsistencia: el cliente no necesita saber la asignación interna del rider, y anunciarla generaría expectativa antes de que el pedido salga. Toda divergencia intencional debe estar en esta tabla; si no está acá, es un error.

### Conexión

| Estado | Texto único | Color | Presentación |
|---|---|---|---|
| Todo al día | **Sincronizado** | `success` | Discreto y permanente |
| Reintentando | **Reconectando** | `info` | Franja + texto |
| Sin red | **Sin conexión** | `warning` | Franja persistente + última hora de dato + acción “Sincronizar ahora” |

Prohibido: “Online/Offline” en inglés, “Conectado”, “Actualizando”, “Error de red”.

### Acciones

| Concepto | Texto único | Prohibido |
|---|---|---|
| Sumar al carrito | **Agregar** | Añadir, Comprar, + |
| Ver el carrito | **Ver pedido** | Ver carrito, Mi compra, Checkout |
| Cerrar la compra | **Confirmar pedido** | Finalizar, Pagar, Enviar |
| Aceptar en el local | **Aceptar** | Confirmar, Tomar |
| Pasar a preparación | **Comenzar preparación** | Preparar, Iniciar |
| Marcar terminado | **Marcar listo** | Finalizar, Completar |
| Dar al rider | **Entregar a rider** | Despachar, Asignar salida |
| Rider retira | **Confirmar retiro** | Recoger, Pickup, Tomar |
| Cerrar la entrega | **Confirmar entrega** | Finalizar, Entregado |
| Vaciar el buscador | **Limpiar búsqueda** | Borrar, Reset, Cancelar |

### Sustantivos

| Concepto | Palabra única | Prohibido |
|---|---|---|
| Compra del cliente | **pedido** | orden, compra, ticket |
| Repartidor | **rider** | delivery, cabify, motoquero |
| Comercio | **local** | tienda, sucursal, negocio (excepto en el rótulo del panel) |
| Artículo | **producto** | ítem, artículo (salvo el contador “4 artículos” del negocio, donde es unidad física) |
| Código de entrega | **código de entrega** | PIN, token, clave |
| Dirección de envío | **dirección** | domicilio, ubicación |

### Contradicciones actuales a eliminar

1. **“Mi pedido” vs “Ver carrito” vs “Pedido”** en el mismo flujo cliente (app bar, barra sticky y nav desktop). → **Ver pedido**.
2. **“Central de pedidos”** como H1 del negocio mientras el eyebrow dice “Operación del local”. → app bar: `Operación`, sin H1 gigante.
3. **“PREVIEW INTERNA”** en la superficie del cliente. → eliminar.
4. **“Recomendados”** (masculino plural) como valor de orden junto a “22 productos”. → mantener **Recomendados**, pero como valor de un control rotulado “Orden”.
5. **“Disponible”** en la tarjeta y **“Precio a confirmar”** en el mismo lugar semántico son cosas distintas: disponibilidad y precio. Separarlas — pill de estado y línea de precio.

---

## Herencia técnica

```
design-system/taba-tokens.css        ← única fuente de color, tipografía, espacio, z, stack inferior
        ├── web: catálogo cliente     (prototypes/prototype-catalog-*.html)
        ├── web: panel del negocio    (prototypes/prototype-business-*.html)
        └── Android: rider            → se exporta a Dart como `TabaTokens` generado desde TOKENS.json
```

**Regla de sincronización:** los tokens de la app Android **se generan** desde `TOKENS.json` en el build, no se transcriben a mano. Un cambio de paleta en la web y un rider desactualizado es una divergencia garantizada. El generador debe fallar si falta un token que el código Dart consume.

## Qué revisa una persona, no un test

- Que el rojo siga significando lo mismo cuando aparezcan pantallas nuevas.
- Que ningún producto adopte la densidad de otro “por consistencia”.
- Que el copy nuevo entre en la tabla de vocabulario antes de mergearse.
- Que las divergencias intencionales (como `assigned` → “Preparando” para el cliente) sigan siendo decisiones, no accidentes.
