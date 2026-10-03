# TABA — Registro de riesgos del proyecto

Severidad y probabilidad: **A** alta / **M** media / **B** baja.

| # | Riesgo | Sev. | Prob. | Detección | Mitigación | Owner |
|---|---|---|---|---|---|---|
| 1 | **Cambios concurrentes sin commitear.** 32 archivos modificados y 6 sin seguimiento, incluidos `js/ui.js`, `js/business.js`, `index.html`, `js/realtime.js` | A | **A** | `git status`; conflictos al mergear | Coordinar antes de la etapa 1; empezar por CSS, que colisiona menos; que el trabajo en curso llegue a un punto commiteable | Coordinación humana |
| 2 | **CSS global.** Los tokens los comparten cliente, negocio, rider y seguimiento (`tracking.css`, 2.981 líneas) | A | **A** | Regresión visual de las 6 vistas | Capturar todo **antes** de la etapa 1; incluir seguimiento en la suite aunque no se toque | Claude Opus |
| 3 | **Service worker sirve CSS viejo** tras cambiar tokens | A | M | Probar con SW registrado, no en incógnito | Verificar la estrategia de `sw.js` y el versionado `?v=` antes de la etapa 1 | Codex |
| 4 | **Caché del navegador y de GitHub Pages** con la cadena de 11 `@import` | M | M | Hard reload vs carga normal | Concatenar con esbuild (etapa 13) con regresión visual completa | Codex |
| 5 | **Solape del stack inferior** vuelve tras un cambio futuro | A | M | Test automático de solape al final del scroll | Fórmula derivada + prohibición de literales + test en CI | Claude Opus |
| 6 | **Estados demo vs producción divergen.** Existen `data-demo-auth-only` y `data-production-only` con caminos distintos | M | M | E2E en ambos modos | Ejecutar los E2E clave en los dos modos; no cambiar la lógica de modo en este trabajo | Codex |
| 7 | **Catálogo generado.** Los 22 productos vienen de datos generados; hay un duplicado real (“Speed Unlimited”) | M | **A** | Validación de unicidad `(nombre, presentación)` | Añadir la validación al pipeline de catálogo; exponer la variante que ya existe en el id | Revisión humana + Codex |
| 8 | **MapLibre por CDN** (`unpkg`) con SRI en `index.html` | M | B | Fallo del mapa con la CDN caída o el hash desactualizado | Auto-hospedar | Codex |
| 9 | **Seguimiento del cliente** se rompe por herencia de tokens | A | M | Regresión visual de la vista de seguimiento | Incluirla en la suite obligatoria | Claude Opus |
| 10 | **Relay de demostración** confundido con backend | A | B | Revisión de configuración | Prohibido en cualquier flavor de Android; test de configuración | Arquitectura |
| 11 | **Supabase**: RLS mal definida expone datos de clientes | A | M | Tests de contrato con dos riders y dos comercios | Tests de RLS obligatorios antes de habilitar el rider | Backend |
| 12 | **PII**: teléfono, dirección o código de entrega en logs, telemetría o notificaciones | A | M | Revisión de eventos; test de scrubbing | `beforeSend` obligatorio; payload de push sin PII; proyección del pedido activo | Seguridad |
| 13 | **Permisos de Android** rechazados en el campo | A | M | `permission_result` | Explicación previa; pedir en el primer retiro; sin permiso de segundo plano | Producto |
| 14 | **Batería** insuficiente para un turno | A | M | `battery_sample`; medición en turno real | Muestreo por estado; bloqueo de release por encima de 12 %/h | Android |
| 15 | **GPS**: servicio detenido por el fabricante | A | **A** | `location_service_killed_by_system` | Matriz con Samsung y Xiaomi; detección y aviso; exclusión guiada del ahorro | Android |
| 16 | **Offline**: acciones perdidas | A | M | `outbox_rejected`, comandos expirados | Escritura local antes de la UI; `cmd_id`; sin descarte silencioso; cola visible | Android |
| 17 | **Transición web → Android**: se retira la web demasiado pronto | A | M | Métricas del despliegue progresivo | La web no se apaga antes de la etapa 8.4; 4 semanas sin incidencias | Producto |
| 18 | **Divergencia de estados** entre superficies | A | M | Auditoría de `order_events` con origen | Un solo juego de RPCs; ninguna superficie escribe tablas | Backend |
| 19 | **Regresiones E2E** por cambio de selectores | M | **A** | La suite falla | Migrar los tests en el mismo commit; preferir selectores por rol y nombre accesible | Codex |
| 20 | **`overflow-x: hidden` enmascara desbordes reales** | M | **A** | Medir `scrollWidth` con la regla desactivada | Añadir esa variante al test de CI | Codex |
| 21 | **Safe areas** no verificables en emulación | A | **A** | Sólo se detecta en dispositivo físico | Validación obligatoria en iPhone y Android reales antes del merge de la etapa 1 | Revisión humana |
| 22 | **Orden de fuente del CSS** al concatenar con esbuild altera reglas que dependen de él | A | M | Regresión visual completa tras la etapa 13 | Tratar la etapa 13 como cambio de riesgo, no como tarea de build | Codex |
| 23 | **Rechazo del cambio visual** por parte del negocio tras implementarlo | M | M | Revisión de prototipos | Los prototipos existen precisamente para decidir **antes** de tocar el repositorio | Revisión humana |
| 24 | **Se empieza por Flutter** sin formalizar el contrato | A | **A** | Aparece tarde, en la fase de transiciones | Fase 0 bloqueante | Arquitectura |

## Los cinco riesgos que más importan

1. **#1 · Cambios concurrentes** — es el más probable y el más barato de evitar: hablar antes de empezar.
2. **#2 y #9 · CSS global** — un cambio de tokens toca cuatro productos; sin capturas previas no hay forma de saber qué se rompió.
3. **#21 · Safe areas** — la etapa 1 se puede dar por buena en emulación y fallar en el teléfono del cliente.
4. **#15 · Foreground service** — es el riesgo técnico que puede invalidar la propuesta del rider si no se certifica en dispositivos reales.
5. **#24 · Orden de la migración del rider** — construir la app antes que el contrato desperdicia semanas.
