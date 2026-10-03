# TABA Rider Android — Especificación de UX

Prototipo navegable: `prototypes/prototype-rider-android.html` (14 pantallas). Capturas: `screenshots/rider-*.png`.

## Estructura de pantalla

```
┌──────────────────────────────┐
│ Barra superior 56px  ink-900 │  ← título único, estado de turno, ⋮
├──────────────────────────────┤
│ Franja de estado (opcional)  │  ← offline / sincronizado / ubicación activa
├──────────────────────────────┤
│                              │
│  Contenido con scroll        │
│                              │
├──────────────────────────────┤
│ Zona de acción               │  ← 1 primaria de 56px + secundarias
│ padding-bottom: safe-area    │
└──────────────────────────────┘
```

La zona de acción **nunca hace scroll**. Está siempre en el pulgar. La barra superior es `ink-900` con texto blanco (**18,11:1**) por legibilidad bajo sol directo.

## Reglas de interacción

1. **Una acción primaria por pantalla**, 56px de alto, ancho completo, rojo TABA.
2. **Las acciones irreversibles se confirman deslizando** (`SlideToConfirm`): confirmar retiro y confirmar entrega. Evita el toque accidental con guantes o con el teléfono en el soporte. Siempre con equivalente por pulsación (`Enter`/`Espacio`, TalkBack).
3. **Sin texto libre obligatorio.** El código usa teclado propio; las incidencias son una lista de cuatro motivos; la nota es opcional y posterior.
4. **Sin pulsación larga, sin arrastre, sin gestos ocultos.**
5. **Sin diálogos modales encadenados.** Como máximo uno, y sólo para confirmar algo destructivo.
6. **Feedback inmediato y local**: la interfaz cambia al tocar; la red confirma después. Si el servidor rechaza, se avisa explícitamente y se revierte.

## Las 14 pantallas

| Pantalla | Contenido | Acción primaria | Secundarias |
|---|---|---|---|
| `login` | Marca, email, contraseña, nota sobre sesión única por dispositivo | **Ingresar** | ¿Olvidaste la contraseña? |
| `home` (turno) | Conmutador de turno, entregas/tiempo/km del día, estado de ubicación, batería, conexión, historial | **Ver pedidos disponibles (2)** | Terminar turno |
| `orders` | Lista de trabajos con local, destino, artículos, distancia y total | **Tomar #A-1042** | — |
| `detail` | Tarjeta del trabajo, artículos, forma de pago, recorrido en 3 pasos | **Voy al local** | Ver en el mapa · Rechazar… |
| `atstore` | Mapa + ETA, ficha del local, artículos y pago | **Llegué al local** | Navegar · Reportar problema |
| `pickup` | Lista de artículos a verificar contra el ticket | **Deslizá para confirmar el retiro** | Falta un producto |
| `ontheway` | Mapa + ETA, ficha del cliente con referencia, pago | **Estoy llegando** | Navegar · Llamar · Problema |
| `arriving` | Mapa, ficha, importe a cobrar con el vuelto calculado | **Llegué · pedir código** | Llamar · Cliente ausente |
| `code` | 4 casilleros de 64px + teclado numérico propio | **Confirmar entrega** (habilitado con 4 dígitos) | No lo tiene |
| `codeerror` | Franja de error con intentos restantes, casilleros en rojo | **Confirmar entrega** | Entregar con incidencia… |
| `incident` | Cuatro motivos como filas con icono y explicación | **Enviar al local** | Cancelar |
| `offline` | Franja ámbar, **cola de acciones pendientes visible**, ficha del cliente | **Llegué · pedir código** | Reintentar conexión |
| `recovered` | Confirmación de sincronización y de qué se recuperó, con los pasos ya registrados | **Continuar la entrega** | — |
| `shiftend` | Resumen del turno, efectivo cobrado, estado de ubicación y de la cola | **Cerrar turno** | Seguir trabajando |

## Pantallas críticas en detalle

### Retiro (`pickup`)

Lista de artículos con cantidad y presentación para **verificar contra el ticket físico** antes de confirmar. La confirmación es deslizando porque dispara dos efectos irreversibles: el cliente empieza a ver el seguimiento y se activa la ubicación. Se anuncia explícitamente: *“Confirmar el retiro inicia el seguimiento del cliente y activa la ubicación”*.

Salida alternativa: **“Falta un producto”** → incidencia, sin obligar a completar un retiro incorrecto.

### Código de entrega (`code`)

- Cuatro casilleros de 64px, `tabular-nums`, borde `ink-900` al llenarse.
- **Teclado numérico de la aplicación**, teclas de 56px. No se usa el teclado del sistema: con guantes, el teclado alfanumérico es inutilizable, y así se evita autocorrección y sugerencias.
- Botón “Borrar” y salida “No lo tiene”.
- La primaria permanece **deshabilitada** hasta los 4 dígitos.
- La validación es del **servidor**. Sin red, la entrega se registra en la cola y se muestra “Entrega registrada, pendiente de confirmar”.

### Código incorrecto (`codeerror`)

Franja `danger` con **intentos restantes explícitos**, casilleros en rojo y una salida honesta: *“Si el cliente no encuentra el código, podés registrar una entrega con incidencia: queda auditada y la revisa el local.”* El rider nunca queda atrapado, y el sistema conserva la trazabilidad.

### Sin conexión (`offline`)

Franja ámbar permanente: *“Sin conexión · seguí trabajando normal”*. Debajo, **la cola visible** con cada acción pendiente y su hora: “✓ Retiro confirmado 14:38 · se envía sola”. Es la diferencia entre confiar en la app y desconfiar de ella.

Los datos del pedido están en el dispositivo: se puede entregar y cobrar sin señal.

### Recuperación (`recovered`)

Tras cierre de la app o muerte del proceso: franja `info` *“Conexión recuperada · 2 acciones sincronizadas”* y una tarjeta que explica **qué se recuperó y en qué punto estaba**, con los pasos ya registrados marcados. Nada de volver a la pantalla inicial sin explicación.

## Adecuación al uso real

| Condición | Decisión de diseño |
|---|---|
| Detenido en la moto | Una acción primaria de 56px, abajo, sin precisión fina |
| Guantes ligeros | Objetivos ≥ 48dp; teclado numérico de 56px; sin gestos |
| Sol directo | Barra superior 18:1; texto principal 17,8:1; nada de gris claro sobre blanco para información esencial |
| Una mano | Todo lo accionable en el tercio inferior; la información arriba |
| Conexión inestable | Offline como estado normal; cola visible; nada bloquea |
| Batería limitada | Muestreo por estado; mapa sólo en pantallas de ruta; sin animaciones continuas |
| Gama media | Sin efectos costosos, listas simples, imágenes mínimas |

## Movimiento

Transiciones de 160ms. Sin animaciones de entrada por elemento. Con `prefers-reduced-motion` / “Eliminar animaciones” de Android, todo se reduce a cambios instantáneos. **La confirmación deslizante conserva su umbral pero sin animación de retorno.**

## Errores y avisos

| Tipo | Presentación |
|---|---|
| Recuperable (red) | Franja persistente + cola visible; **nunca** un diálogo |
| Rechazo del servidor | Tarjeta en la pantalla con el motivo y la salida (“Este pedido fue reasignado”) |
| Cancelación del local | **Interrumpe** con diálogo: es la única interrupción justificada |
| Validación (código) | En línea, junto a los casilleros, con intentos restantes |
| Fallo inesperado | Pantalla de error con “Reintentar” y código de referencia para soporte |
