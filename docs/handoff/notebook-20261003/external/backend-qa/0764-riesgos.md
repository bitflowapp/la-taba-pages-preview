# Riesgos — TABA2 E2E Test Staging
**Fecha**: 2026-08-05  
**Agente**: TABA2_E2E_TEST_STAGING

---

## Riesgos Críticos (BLOQUEANTES si no se resuelven)

### RIESGO-01: Disco E: casi lleno
- **Severidad**: CRÍTICA
- **Valor actual**: 2.2 GB libres en 298 GB (E:)
- **Impacto**: E: es el disco de scratchpad de la sesión Claude. Builds de Chromium, caches de npm, archivos temporales de tests pueden superar ese margen. Fallo silencioso de escritura o crash de proceso.
- **Mitigación**: Dirigir todos los artifacts E2E a `D:\1212\artifacts\taba2-e2e-test-staging\`. Limpiar E:\DevCache\Temp de sesiones viejas si es posible antes de Gate 1 con PostgreSQL+Chromium.
- **Estado**: ACTIVO — verificar antes de Gate 1.

### RIESGO-02: RAM ajustada con Java activo
- **Severidad**: ALTA
- **Valor actual**: 4.2 GB libres, Java PID 11696 (1433 MB) + PID 14444 (811 MB) = ~2.2 GB de Java solo
- **Impacto**: Supabase local + Docker + Chromium (headless) consumen ~2–4 GB adicionales. Posible OOM durante Gate 1 heavy-compute.
- **Mitigación**: Antes de adquirir `heavy-compute.lock` y correr PostgreSQL+pgTAP: terminar procesos Java huérfanos si no son necesarios en ese momento. Detener Supabase y Docker antes de correr Chromium (según regla 16).
- **Estado**: ACTIVO.

### RIESGO-03: Stale lock `rider-staging-smoke-pending.txt`
- **Severidad**: ALTA (bloquea Gate 4 rider)
- **Descripción**: El lock indica estado BLOCKED_NOT_STARTED con HEAD esperado `1ad7fee` pero la automatización ahora está en `8e2b671` (HEAD superó la condición de desbloqueo). Sin embargo, nadie limpió el lock.
- **Impacto**: Confusión sobre estado del rider. Si el próximo agente rider lee el lock sin analizarlo, puede creer que el smoke está todavía bloqueado por razones vigentes.
- **Mitigación**: Antes de Gate 4, limpiar manualmente `rider-staging-smoke-pending.txt` y crear un lock nuevo bajo el nombre correcto de la sesión E2E. No borrar locks de otras sesiones sin verificar PID (el PID del lock original ya no corre).
- **Estado**: ACTIVO — resolver antes de Gate 4.

---

## Riesgos Altos

### RIESGO-04: Divergencia MP_STAGING_RC1 / PAYMENT_RECOVERY vs RC_PANEL
- **Severidad**: ALTA
- **Descripción**: RC_PANEL y MP_STAGING_RC1/PAYMENT_RECOVERY divergen en `7df4643`. Las Edge Functions MP en RC_PANEL pueden tener versiones distintas a las de MP_STAGING_RC1 (que fue integrado con el staging RC de MP).
- **Impacto**: Si el código de la función `mercadopago-webhook` o `mercadopago-payment-worker` en RC_PANEL está desactualizado respecto al MP_STAGING_RC1, el webhook puede fallar.
- **Mitigación**: Hacer diff explícito de cada Edge Function entre RC_PANEL y MP_STAGING_RC1 antes de integrar. Ver plan-de-integracion.md.
- **Estado**: PENDIENTE análisis en Gate 1.

### RIESGO-05: 3 migraciones en MP_STAGING_RC1/PAYMENT_RECOVERY no presentes en RC_PANEL
- **Severidad**: ALTA
- **Descripción**: `rider_gps_tracking_gate2` (779 líneas), `mercadopago_staging_worker_scheduler` (153 líneas), `payment_recovery_p0` (340 líneas) no están en RC_PANEL.
- **Impacto**: Sin estas migraciones, el webhook worker durable (pg_cron) y el P0 recovery no funcionan. El flujo E2E test no puede validar exactly-once sin payment_recovery.
- **Mitigación**: Integrar las 3 migraciones en el E2E RC. Verificar que son aditivas (no modifican contratos existentes). Ver plan-de-migraciones.md.
- **Estado**: PENDIENTE integración en Gate 1.

### RIESGO-06: Nodos huérfanos consumiendo puertos y RAM
- **Severidad**: MEDIA
- **Descripción**: Node PID 2500 (`taba-panel-preview.mjs` sesión `22e69b5e`) y PID 23144 (`taba2-panel-no-store-server.mjs:4180`). Pueden colisionar con puertos del E2E RC.
- **Mitigación**: Antes de levantar el dev server del E2E RC, verificar que puertos 4180 y otros no estén ocupados. Terminar huérfanos si hay conflicto.
- **Estado**: ACTIVO — gestionar antes de Gate 1 browser.

### RIESGO-07: Main worktree con 35 archivos sucios
- **Severidad**: MEDIA
- **Descripción**: `delivery-pin` feature en progreso sin commitear en `main`. Incluye una migración SQL nueva `20260606090000_delivery_pin_v1.sql` y `js/core/delivery-pin.js`.
- **Impacto**: No bloquea el E2E RC directamente (rama separada). Pero hay riesgo de confusión si alguien hace `git checkout` en main. La migración sin versionar no debe aparecer en staging.
- **Mitigación**: No tocar el worktree main durante el E2E. Verificar que la migración `delivery_pin_v1` NO se incluya en el E2E RC.
- **Estado**: ACTIVO — solo documentado.

---

## Riesgos Medios

### RIESGO-08: Disco C: ajustado (14 GB)
- Riesgo menor que E:. Git operations y npm installs usan C:. Vigilar durante builds.

### RIESGO-09: APK Rider no verificado
- El APK congelado (`d64d688985...`) no se encontró en `D:\1212\worktrees\taba2-rider-map`. Puede estar en otro path o necesita build. Verificar antes de Gate 4.

### RIESGO-10: `la-taba-migration-fetch-audit` en detached HEAD
- Worktree en `D:\1212\la-taba-migration-fetch-audit` en `7df4643` (detached HEAD). Es el merge-base de RC_PANEL vs MP_STAGING_RC1. No debe modificarse.

### RIESGO-11: Java/Gradle corriendo durante heavy-compute
- 2 procesos Java (~2.2 GB) posiblemente relacionados con Rider Android (Gradle). Confirm si están activamente construyendo antes de adquirir heavy-compute.lock.

---

## Riesgos Bajos (documentados, no críticos)

- Muchos worktrees huérfanos en C:\1212 (30+). No bloquean pero ocupan espacio y contexto.
- Cargo/Tauri targets en D:\1212 (de sesiones previas). Solo espacio en disco.
- Locks como archivos `.txt` en vez de directorios atómicos. El mecanismo actual no es verdaderamente atómico pero es suficiente para el flujo de un solo agente a la vez.

---

## Tabla de Estado General

| Área | Estado | Bloqueante |
|---|---|---|
| Worktrees esperados | ✅ TODOS OK | No |
| HEADs verificados | ✅ TODOS MATCH | No |
| Git operations | ✅ NINGUNA | No |
| Secrets en Git | ✅ SOLO .env.example | No |
| RC1 certificado | ✅ TABA2_RC1_BUSINESS_PANEL_INTEGRATION_CERTIFIED_B6D27DA | No |
| Disco E: | ❌ 2.2 GB libre | Sí (Gate 1 heavy) |
| RAM | ⚠️ 4.2 GB libre | Sí (Gate 1 simultáneo) |
| Stale lock rider | ⚠️ Necesita limpieza | Sí (Gate 4) |
| Migraciones a integrar | ⚠️ 3 pendientes | Sí (Gate 1) |
| Edge Functions diff | ⚠️ No verificado | Sí (Gate 1) |
| APK Rider | ⚠️ No verificado | Sí (Gate 4) |
