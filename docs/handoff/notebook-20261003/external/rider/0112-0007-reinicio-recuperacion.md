# ADR-0007: Reinicio y recuperación conservadores

- Estado: aceptado.
- Decisión: persistir una entrega activa mínima; al iniciar service/app validar sesión, membership, asignación, estado y revisión mediante lectura autorizada. Restaurar sólo si sigue operativa; terminal siempre detiene y purga.
- Alternativas: reanudar sin servidor; borrar todo ante cualquier kill; cambiar estado remoto automáticamente.
- Motivo: Android puede matar procesos y el backend no ofrece una RPC de pausa/cancelación rider observada.
- Consecuencia: tras pérdida de sesión se puede detener GPS dejando pedido remoto activo; se requiere recuperación manual.
- `START_STICKY` y BootReceiver son best-effort, nunca garantía de Android.

