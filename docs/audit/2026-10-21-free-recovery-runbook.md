# La Taba Free: operación y recuperación

Destino autorizado: `ixewllzzuzpqrkxzmfzx`, organización La Taba Free `tpdpuvnasszkcpdanxpk`, región `sa-east-1`. Presupuesto adicional USD 0. No usar las referencias eliminadas ni APEX, Estela o Bitflow.

## Estado durante QA

- Comercio pausado; pagos comerciales y pedidos deshabilitados.
- Entorno Mercado Pago test. Cinco schedulers `taba-*` desactivados hasta completar secretos y revisión.
- Ningún token productivo, addon pago ni aprobación de cobros reales.
- Respaldos e identidades de prueba fuera de Git y de carpetas públicas.

## Comandos reproducibles

Ejecutar desde el worktree existente. Los scripts validan recibo, proyecto y organización Free. Las claves guardadas deben pertenecer a la referencia exacta.

```powershell
$env:TEMP = $env:TABA_RECOVERY_TEMP
$env:TMP = $env:TEMP
$env:NODE_DISABLE_COMPILE_CACHE = '1'

# Reanudación del esquema: exige cero usuarios Auth.
node scripts/recovery/bootstrap-hosted.mjs --apply --phase schema --target deploy/recovery-free-hosted.json --manifest docs/audit/2026-10-21-hosted-recovery-plan-20261021-final.json

node scripts/recovery/deploy-functions.mjs --apply --target deploy/recovery-free-hosted.json --manifest docs/audit/2026-10-21-hosted-recovery-plan-20261021-final.json --evidence "$env:TABA_RECOVERY_EVIDENCE_DIR/redeploy.jsonl"

node scripts/recovery/verify-hosted-sql.mjs --run-tests --target deploy/recovery-free-hosted.json --evidence-directory "$env:TABA_RECOVERY_EVIDENCE_DIR/sql-repeat"

node scripts/recovery/verify-hosted-api.mjs --run-tests --target deploy/recovery-free-hosted.json --evidence-directory "$env:TABA_RECOVERY_EVIDENCE_DIR/api-repeat"

# Sólo antes de conectar un vendedor y sin trabajos pendientes.
node scripts/recovery/verify-functions.mjs --run-tests --target deploy/recovery-free-hosted.json --evidence "$env:TABA_RECOVERY_EVIDENCE_DIR/functions-repeat.json"
```

La prueba API crea una identidad anónima y un objeto Storage sintéticos, verifica permisos y los elimina. Cambia `updated_at` del comercio pausado para comprobar Realtime. Las suites SQL hacen ROLLBACK. No ejecutarlas automáticamente sobre un futuro proyecto comercial.

`prepare-preview.mjs --target deploy/recovery-free-hosted.json --out "$env:TABA_RECOVERY_OUTPUT_DIR" --commit SHA_REVISADO` prepara el sitio existente y genera hashes. Rechaza sobrescribir directorios y no publica. Después ejecutar `check-runtime-config.mjs` y `scan-production-artifacts.mjs`. El acceso Cloudflare debe renovarse antes de publicar únicamente la rama preview, sin promoverla a producción.

## Backup comercial: pendiente, sin servicio pago

La reconstrucción desde migraciones y un respaldo parcial no es un ensayo de restauración de un dump completo. [Backups oficiales](https://supabase.com/docs/guides/platform/backups), [procedimiento de exportación/restauración](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

1. Elegir un destino externo cifrado y retención con Walter. Los cientos de MB libres actuales en D: no alcanzan para respaldos comerciales crecientes ni constituyen copia externa.
2. Usar PostgreSQL compatible o Supabase CLI con sus requisitos locales. Se consultó `supabase db dump --help`. No había pg_dump/psql disponibles y no se descargó Docker por falta de espacio. **No existe todavía un dump completo ni tarea automática demostrados.**
3. Obtener la conexión exacta en Dashboard Connect. Preferir session pooler si no hay IPv6. Leer la contraseña del Credential Manager; nunca pasar URL con contraseña o contraseñas por argumentos, logs o archivos versionados. Un ejecutor debe inyectarlas sólo al entorno de su proceso hijo y limpiarlo.
4. Exportar roles, esquema y datos; verificar expresamente cobertura de Auth, metadatos Storage, RLS, publicaciones, funciones SQL y registros de migración. Preservar código Edge, manifiesto y configuración. Los secretos requieren almacén cifrado y recuperación probada.
5. Exportar objetos Storage por separado, con inventario y hash: un dump de base sólo incluye sus metadatos.
6. Registrar fecha, herramientas, tamaño, SHA-256 y resultado de restauración. Nunca subir dumps ni tokens a Git.
7. Restaurar en una base aislada identificada expresamente. No borrar ni reinicializar el proyecto alojado; no exceder el cupo Free. Si falta disco o cupo, documentarlo sin cambiar automáticamente a Pro.
8. Comprobar datos, Auth, RLS, Storage, Realtime y pedidos/pagos con fixtures. Sólo después programar backup y alertas.

## Monitoreo pendiente

Los controles alojados no constituyen una guardia automática. Antes de vender deben vigilarse disponibilidad, outbox, reintentos, trabajos bloqueados, reservas vencidas, divergencias pedido/stock, último backup válido y renovación/revocación OAuth. Falta canal y destinatario aprobado; no se enviaron mensajes ni se contrató monitoreo.

El watchdog heredado tiene acceso anónimo deliberado y puede actualizar alertas. Revisarlo junto con los avisos SECURITY DEFINER antes de activarlo. No revocar permisos indiscriminadamente ni ejecutar scripts productivos fijados a referencias antiguas.

## Git en D:

```powershell
git --git-dir "$env:TABA_RECOVERY_GIT_DIR" --work-tree "$env:TABA_RECOVERY_WORKTREE" log -3 --oneline
git --git-dir "$env:TABA_RECOVERY_GIT_DIR" --work-tree "$env:TABA_RECOVERY_WORKTREE" status --short
```

La rama usa objetos previos mediante alternates hacia otra copia local. No es un backup independiente: no eliminar ni mover el repositorio original. La revisión no requiere publicar producción.
