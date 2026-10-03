# ADR-004 — Recuperación explícita, no promesa de supervivencia total

Estado: Propuesto  
Fecha: 2026-08-02

## Contexto

El RPC start puede cambiar la orden a on_the_way antes de que el servicio se promueva. START_STICKY ayuda en algunos reinicios, pero no garantiza recreación completa, sesión válida, red ni comportamiento de OEM. force-stop y algunas acciones del sistema bloquean la recuperación automática.

## Decisión

Persistir un active delivery intent cifrado y una cola durable; protegerlos con rider scope, order/revision y version. DeliveryServiceCoordinator usa un lock de orden activa. Al iniciar app/servicio, RecoveryPolicy consulta la orden asignada existente, valida identidad/revision/permisos y ofrece o ejecuta recovery conforme a una política visible. Un estado técnico nunca muta por sí solo el estado comercial.

No prometer auto-resume después de force-stop, reboot, app uninstall, teléfono apagado u OEM battery killer. BootReceiver solo se añadirá si la política Android y la certificación del dispositivo lo permiten; la ruta segura por defecto es notificación/manual resume.

## Alternativas consideradas

1. Confiar solo en START_STICKY: descartada; no resuelve reconciliación ni contrato de sesión.
2. Auto-cambiar orden a delivered/cancelled al detener servicio: descartada; mezcla tracking con negocio.
3. Reintentar start RPC con una firma inventada: descartada; el contrato real solo admite order_id/revision.
4. Auto-reanudar después de force-stop: descartada por restricciones del sistema y expectativas inseguras.

## Consecuencias

Positivas: reduce órdenes huérfanas y hace visibles los límites reales.  
Negativas: algunos eventos requieren acción del rider; se necesita UX de recovery y pruebas OEM.

## Requisitos de aceptación

- process kill/crash recupera metadata/queue sin dos servicios.
- revisión obsoleta produce reconcile, no publicaciones ciegas.
- notification pause no completa/cancela backend.
- force-stop y reboot tienen resultado documentado, sin claim de garantía.
- orden terminal detiene FGS, FLP y queue.
