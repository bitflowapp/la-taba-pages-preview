# Prompt Codex — Etapa 9: recuperación

Implementá recuperación de entrega activa.

Leé `ANDROID_LIFECYCLE.md`, `SECURITY_MODEL.md`, ADR-0003/0007 y el contrato. Creá `ActiveDeliveryRecovery`, `RecoveryPolicy`, receivers best-effort y lógica de startup para Flutter/service. Al reabrir o recrear proceso, validá sesión, membership, order id, assignee, estado, revision y snapshot remoto antes de reactivar.

Si la entrega es válida y no terminal, restaurá notification/service. Si es delivered/cancelled/rejected, detené y purgá. Si pertenece a otro rider o la sesión no puede refrescarse, detené GPS y borrá cola/secretos según política. No inventes RPC de pausa/cancelación ni cambies status por update directo.

Pruebas: Flutter process death, service recreation, app reopen, terminal, otro rider, stale revision, refresh inválido, reboot best-effort, swipe y Force stop documentado como no garantizable.

Aceptación: los eventos perdidos se reconstruyen desde snapshot; ninguna reanudación se decide sólo por memoria local. No tocar backend.

