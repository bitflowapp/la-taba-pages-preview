# ARCA readiness — arquitectura auditada

Fecha de auditoría: 2026-08-03.

- Fuente: `C:\1212\la-taba-production-rc1`, `release/taba2-production-rc1`, `4ca22af6d425c422fdca2be8e11798a2de170033`.
- Worktree de preparación: `C:\1212\la-taba-arca-homologation-readiness`, `feature/taba2-arca-homologation-readiness`.
- HEAD final de preparación: `13936d5` (cuatro commits locales, sin push).
- El commit fiscal `89bda02b73b651cc42f8c9fa3a008903501f89e9` está contenido en el RC.
- El bridge privado está en `services/arca-fiscal-bridge`; su health sólo escucha en loopback.
- El panel Windows usa `Configuración fiscal` y sólo recibe indicadores sanitizados. No acepta claves, certificados completos, tokens WSAA ni secretos.
- Persistencia y outbox fiscal están en las migraciones existentes `20260802160000`, `20260802170000` y `20260802171000`.
- WSAA, WSFEv1, FEDummy, parámetros, numeración, idempotencia, reconciliación ambigua, QR, PDF y Storage ya tienen contratos y tests locales en el bridge.

No se contactó ARCA, Supabase remoto ni producción durante esta preparación.
