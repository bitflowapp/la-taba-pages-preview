# TABA Rider Android — Permisos

## Declarados en el manifiesto

| Permiso | Necesario para | Nivel |
|---|---|---|
| `INTERNET` | Todo | normal |
| `ACCESS_NETWORK_STATE` | Disparar el drenaje de la cola | normal |
| `ACCESS_FINE_LOCATION` | Seguimiento durante la entrega | **peligroso** |
| `ACCESS_COARSE_LOCATION` | Respaldo si sólo se concede aproximada | peligroso |
| `FOREGROUND_SERVICE` | Servicio de ubicación | normal |
| `FOREGROUND_SERVICE_LOCATION` | Obligatorio desde API 34 | normal |
| `POST_NOTIFICATIONS` | Avisos de pedido nuevo (API 33+) | **peligroso** |
| `WAKE_LOCK` | Lo usa el foreground service | normal |
| `RECEIVE_BOOT_COMPLETED` | Restaurar la cola tras reinicio | normal |
| `CALL_PHONE` | **No se pide** — se usa `ACTION_DIAL`, que no requiere permiso | — |

**No se declara `ACCESS_BACKGROUND_LOCATION`.** El foreground service cubre el caso de uso completo, evita una pantalla de permiso con altísima tasa de rechazo y elimina la declaración adicional de uso de ubicación en segundo plano ante Play Store.

## Momento de la solicitud

Ningún permiso se pide al abrir la app. Cada uno se pide cuando su utilidad es evidente, y **siempre con una pantalla propia de explicación antes** del diálogo del sistema.

| Permiso | Momento | Explicación previa |
|---|---|---|
| Notificaciones | Al activar el turno por primera vez | “Para avisarte cuando entre un pedido, aunque tengas la app cerrada.” |
| Ubicación precisa | Al confirmar el **primer retiro** | “Mientras llevás el pedido, el cliente ve por dónde vas. Se apaga sola cuando entregás.” |

Pedir la ubicación en el retiro y no en el login es deliberado: en ese punto el rider ya entiende para qué sirve, y la tasa de concesión es muy superior.

## Denegación

| Permiso | Consecuencia | Salida |
|---|---|---|
| Notificaciones denegado | La app funciona; no llegan avisos con la app cerrada | Aviso persistente en `home` con acceso directo a Ajustes |
| Ubicación denegada | **No se puede confirmar el retiro** (el seguimiento es parte del servicio) | Pantalla que explica por qué es imprescindible, botón a Ajustes y opción de liberar el pedido |
| Ubicación “sólo aproximada” | Se acepta, con aviso de que el seguimiento será menos preciso | Sugerencia de activar precisa |
| Ubicación “sólo esta vez” | Funciona el turno; se vuelve a pedir al siguiente | Se explica al detectar la revocación |
| Denegado permanentemente | El diálogo del sistema ya no aparece | Enlace directo a los ajustes de la app |

## Optimización de batería

No se pide exclusión de forma proactiva. **Se detecta** que el sistema detuvo el foreground service durante una entrega y recién entonces se ofrece: “Android detuvo el seguimiento. Para evitarlo, excluí TABA Rider del ahorro de batería.” Pedirlo antes, sin motivo visible, genera rechazo y sospecha.

## Revocación en caliente

Android permite revocar permisos con la app en uso. Al reanudar se revalida cada permiso y, si falta uno crítico durante una entrega activa, se muestra un aviso persistente con la vía de solución — sin perder el pedido ni la cola.

## Play Store

- Declaración de uso de ubicación en primer plano, con vídeo del flujo retiro → entrega.
- Sección de seguridad de datos: ubicación recogida sólo durante la entrega, retenida 7 días, no compartida con terceros, no usada para publicidad.
- Política de privacidad accesible desde la app y desde la ficha.
- La app es de **uso interno para riders del comercio**: distribución por canal cerrado (testing interno o enlace privado) hasta que el flujo esté certificado.
