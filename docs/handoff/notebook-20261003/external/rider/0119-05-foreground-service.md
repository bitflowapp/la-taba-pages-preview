# Prompt Codex — Etapa 5: ForegroundService

Implementá el esqueleto seguro del `RiderForegroundService`, todavía sin publicación GPS completa.

Leé `ANDROID_LIFECYCLE.md`, `SECURITY_MODEL.md`, ADR-0006 y el árbol. Creá service, state machine, notification controller, permission manager y coordinator. Declaralo como foreground service de `location`, `exported=false`, `stopWithTask=false`; no implementes `onTaskRemoved` como stop. La notificación debe ser persistente, no incluir dirección completa ni coordenadas y mostrar estado técnico.

El service no debe depender de Flutter para mantenerse vivo. Debe aceptar prepare/activate/stop, persistir sólo metadata mínima de entrega activa y emitir estados por EventChannel. Terminal/logout/emergency stop deben cancelar captura, workers y notificación.

Pruebas: startForeground dentro del deadline, permiso denegado, notification channel, stop idempotente, process recreation, swipe de recientes instrumentado y no start en estado no autorizado.

Aceptación: el service puede permanecer sin Flutter, su estado se recupera por bridge y todos los stops son idempotentes. No implementar todavía RPC GPS ni tocar backend.

