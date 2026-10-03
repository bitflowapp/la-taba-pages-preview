# TABA Rider Android — Plan de migración

## Punto de partida honesto

- La app Android **no existe**. No hay proyecto Flutter.
- Existe una **vista rider web** dentro de la PWA, funcional en modo demo.
- La máquina de estados está **repartida** entre la UI, `js/core/order-status.js` y `js/core/order-workflow.js`. No está formalizada en el backend.
- El relay de demostración **no es** un backend válido para Android.

Por eso la migración **no empieza por Flutter**. Empieza por el contrato.

## Fases

### Fase 0 · Formalizar el contrato (sin tocar Android)

**Objetivo:** que exista una máquina de estados y un juego de RPCs probados en producción por la web antes de escribir Dart.

1. Escribir `order_status` y las transiciones T1–T9 como esquema de Supabase, con `command_log` para idempotencia.
2. Implementar los RPCs de `RIDER_ANDROID_BACKEND_CONTRACT.md` con `SECURITY DEFINER`.
3. Definir RLS y la vista `rider_active_order`.
4. **Migrar la vista rider web a esos RPCs**, manteniendo el modo demo detrás de un flag.
5. Tests de contrato contra `staging`.

**Salida:** contrato validado con tráfico real. **Sin esta fase, Android construye sobre arena.**

### Fase 1 · Andamiaje Flutter

Proyecto `taba_rider`, capas y flavors; `taba_tokens.dart` generado desde `TOKENS.json`; go_router con rutas vacías; Drift con esquema y migración inicial; CI que compile y analice. Se entrega un APK que arranca y navega con datos falsos.

### Fase 2 · Autenticación y sesión

Login contra Supabase staging, token en Keystore, refresco, sesión por dispositivo, `session.revoked`, cierre de sesión con verificación de cola vacía. Se entrega login real contra staging.

### Fase 3 · Lectura de pedidos

Lista y detalle desde `rider_active_order`; Realtime con reconciliación por `rpc_sync_state`; Drift como fuente de verdad de la UI. **Sin acciones todavía.** El rider puede *mirar* pedidos reales.

### Fase 4 · Cola durable y transiciones

Outbox con `cmd_id`, backoff y orden por pedido; T1–T5, T7 y T9; UI optimista con reversión ante rechazo; pantallas offline y de recuperación. Se entrega la app operativa **sin ubicación**.

Es el hito de mayor riesgo y donde más pruebas se necesitan.

### Fase 5 · Ubicación

Foreground service nativo, notificación persistente, muestreo por estado, filtro de calidad, buffer y envío por lotes, apagado en el cierre. Medición de batería en turno real.

### Fase 6 · Notificaciones

FCM, canales, deep links, sonido de pedido nuevo, avisos si el canal crítico está silenciado.

### Fase 7 · Certificación

Matriz de dispositivos, muerte del proceso, cambios de red, batería, permisos, seguridad, accesibilidad con TalkBack, y **un turno completo real** con un rider.

### Fase 8 · Despliegue progresivo

| Etapa | Alcance | Criterio para avanzar |
|---|---|---|
| 8.1 | 1 rider, 1 semana, con la web como respaldo | 0 acciones perdidas |
| 8.2 | Todos los riders de un local, 2 semanas | Batería en objetivo, < 2 % de fallo de código |
| 8.3 | Todos los locales | Métricas estables 2 semanas |
| 8.4 | La vista rider web pasa a **sólo lectura** | 4 semanas sin incidencias |
| 8.5 | Se retira la vista rider web | Decisión del negocio |

El flag `android_rider_enabled` gobierna cada etapa. **La web nunca se apaga antes de 8.4.**

## Qué se conserva de la web

| Elemento | Decisión |
|---|---|
| Código de entrega (concepto y contrato) | **Se conserva** |
| Estados del pedido | Se conservan los nombres; se formaliza el grafo |
| Flujo local → cliente | Se conserva |
| Prueba de entrega | Se conserva el contrato |
| Estilos CSS | No se migran |
| Mapa MapLibre | Se conserva la tecnología, cambia la implementación |
| Relay de demostración | **No se usa** |
| Acceso por PIN | **No se traslada**: autenticación real |

## Estrategia de convivencia

Durante las fases 3 a 8.4, un mismo pedido puede ser atendido desde la web o desde Android. Por eso:

- **Ambas hablan con los mismos RPCs.** Ninguna escribe en tablas directamente.
- La idempotencia por `cmd_id` protege de acciones duplicadas entre superficies.
- El panel del negocio muestra desde qué superficie se registró cada transición.
- Un pedido asignado a un rider en Android **no puede** avanzarse desde la web con otra sesión: lo impide la validación de autoría.

## Riesgos de la migración

| Riesgo | Mitigación |
|---|---|
| Empezar por Flutter y descubrir tarde que el contrato no cierra | Fase 0 obligatoria y bloqueante |
| Divergencia de estados entre web y Android | Un solo juego de RPCs; el panel muestra el origen |
| El foreground service no sobrevive en algún fabricante | Certificación en matriz real; detección y aviso |
| Acciones perdidas en la transición | La cola durable es anterior a la ubicación (fase 4 antes que 5) |
| Rechazo de permisos en el campo | Explicación previa y solicitud en el momento útil |
| Play Store demora por ubicación | Distribución interna hasta certificar; sin permiso de segundo plano |

## Lo que NO se hace ahora

- No se crea el proyecto Flutter en esta propuesta.
- No se escribe código Dart.
- No se toca el repositorio de la PWA.
- No se define el calendario: depende de la disponibilidad del equipo y de decisiones comerciales.
