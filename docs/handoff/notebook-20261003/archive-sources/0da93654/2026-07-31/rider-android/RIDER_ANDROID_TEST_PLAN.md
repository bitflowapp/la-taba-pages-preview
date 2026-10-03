# TABA Rider Android — Plan de pruebas

## Pirámide

| Nivel | Alcance | Umbral |
|---|---|---|
| **Unit** | `domain/` — políticas de transición, geocerca, filtro de GPS, backoff, mapeadores | Cobertura ≥ 90 % |
| **Widget** | Pantallas con controlador falso: estados, accesibilidad, deshabilitados | Las 14 pantallas |
| **Integration** | Flujos completos en emulador con Supabase staging | Los 25 flujos |
| **Contract** | Firmas de RPC, códigos de error, RLS | Todos los RPCs |
| **Manual** | Dispositivos reales, batería, sol, guantes | Por release |

## Unit

- **Transiciones**: para cada una de T1–T9, camino feliz, precondición no cumplida, y transición inválida rechazada. Tabla de verdad completa `estado × comando`.
- **Idempotencia**: dos comandos con el mismo `cmd_id` producen un solo efecto.
- **Filtro de GPS**: precisión > 100 m, salto > 130 km/h, punto demasiado cercano, timestamp futuro.
- **Geocerca**: entrada y salida del radio de 300 m con histéresis (no debe oscilar).
- **Backoff**: progresión y jitter dentro del rango.
- **Orden de la cola**: comandos de un mismo pedido salen en secuencia; de pedidos distintos, en paralelo.
- **Prioridad de drenaje**: `confirm_delivery` antes que los lotes de ubicación.
- **`OrderStatus.fromJson`** con un valor desconocido → `unknown` + registro, no excepción.
- **Scrubbing de PII**: un evento con nombre, teléfono, dirección o código no sale de `beforeSend`.

## Widget

Por pantalla: estado normal, cargando, error, offline. Y en todas:

- La acción primaria existe, es única y mide ≥ 56px.
- Todo control interactivo mide ≥ 48dp.
- Los controles de sólo icono tienen `Semantics.label` que nombra el objeto concreto.
- El estado se comunica con texto además de color.
- Con `MediaQuery.disableAnimations` no hay animaciones.

Específicos:
- `code`: la primaria está deshabilitada con menos de 4 dígitos; el teclado propio funciona sin el del sistema.
- `codeerror`: se muestran los intentos restantes; existe la salida por incidencia.
- `pickup`: la confirmación deslizante tiene equivalente por pulsación y `Semantics` correcto.
- `offline`: la cola pendiente se lista con horas.
- `recovered`: se detalla qué se recuperó.

## Integration (emulador + Supabase staging)

| # | Escenario | Verificación |
|---|---|---|
| 1 | Login → turno → tomar → retirar → entregar | Estado final `delivered`; cola vacía; ubicación detenida |
| 2 | Código incorrecto ×3 | Bloqueo tras 3 intentos; salida por incidencia |
| 3 | Entrega offline | Estado “pendiente de confirmar”; al reconectar, `delivered` |
| 4 | Entrega offline con código incorrecto | Al reconectar vuelve a `arriving` con aviso claro |
| 5 | Cancelación del local durante `on_the_way` | Diálogo irruptivo; trabajo liberado; ubicación detenida |
| 6 | Reasignación mientras el rider está offline | Comandos rechazados con mensaje; sin estado inconsistente |
| 7 | Muerte del proceso en `on_the_way` | Al reabrir, ruta y estado restaurados; servicio reanudado |
| 8 | Cambio de dispositivo | Sesión anterior revocada; pedido activo recuperado |
| 9 | Sesión expirada sin red | Se sigue trabajando; al reconectar se pide login **sin perder la cola** |
| 10 | Cambio 4G ↔ Wi-Fi durante la entrega | Sin duplicados ni pérdidas |
| 11 | Modo avión 10 min con 5 acciones | Las 5 se drenan en orden correcto |
| 12 | Permiso de ubicación denegado | No se puede confirmar retiro; explicación y salida |
| 13 | Permiso revocado durante la entrega | Aviso persistente; el pedido no se pierde |
| 14 | Servicio detenido por el sistema | Se detecta, se avisa, se ofrece excluir del ahorro |
| 15 | Turno cerrado con cola pendiente | Se avisa y se ofrece esperar el drenaje |

## Contract

Contra Supabase staging, en CI:

- Cada RPC: firma, tipos, códigos de error documentados.
- Idempotencia: llamada repetida con el mismo `cmd_id` devuelve la respuesta guardada.
- RLS: un rider **no puede** leer pedidos de otro `business_id` ni de otro rider; el intento devuelve `NOT_FOUND`, no `FORBIDDEN`.
- La proyección `rider_active_order` **no contiene** teléfono completo ni código de entrega. Test explícito de ausencia de campos.
- `rpc_push_locations` rechaza puntos sin pedido activo y fuera de la ventana `picked_up`…`delivered`.
- Los datos del cliente desaparecen de la proyección tras `delivered`.

## Pruebas manuales por release

### Matriz de dispositivos

| Dispositivo | Android | Por qué |
|---|---|---|
| Moto G15 (referencia) | 14/15 | El equipo real del rider |
| Samsung gama media (A15/A25) | 14 | One UI mata servicios agresivamente |
| Xiaomi/Redmi gama media | 13/14 | MIUI es el peor caso conocido para foreground services |
| Pixel | 15 | Android de referencia |
| Dispositivo con 2 GB de RAM | 13 | Provoca muerte del proceso con facilidad |

### Batería

Turno simulado de 4 h con ubicación activa: nivel al inicio y al final, `Battery Historian`, consumo por hora. **Objetivo < 8 %/h**; se bloquea el release por encima de 12 %.

### Campo

- Uso con guantes ligeros: teclado del código y confirmación deslizante.
- Sol directo: legibilidad de la barra superior, del ETA y del código.
- Una mano, en el soporte de la moto, detenido.
- Recorrido real por una zona sin cobertura conocida.
- Un turno completo con un rider real, con la web como respaldo.

### Accesibilidad

- TalkBack en los 25 flujos.
- Tamaño de fuente del sistema al 130 % y 200 %: sin texto cortado ni acción inalcanzable.
- Contraste medido sobre las capturas reales.

### Seguridad

- Interceptar tráfico con proxy: debe fallar por pinning.
- Inspeccionar la base local: debe estar cifrada.
- Revisar logs y eventos de Sentry: cero PII.
- Ubicación simulada: se marca `mock` y se alerta al negocio.
- Cierre de sesión remoto desde el panel: efecto inmediato.

## Artefactos

- APK de `staging` en cada PR a `main`.
- AAB de `prod` sólo por tag, firmado en CI.
- Reporte de la matriz de dispositivos adjunto a cada release.

## Criterios de bloqueo

Un release **no sale** si: hay una acción perdida en las pruebas de cola; la batería supera 12 %/h; la app no se recupera de la muerte del proceso; se detecta PII en telemetría; o el código de entrega falla en más del 5 % de los intentos.
