# Respaldo y restauración de La Taba Free

Fecha: 21/10/2026. Proyecto autorizado `ixewllzzuzpqrkxzmfzx`, organización La Taba Free. No se creó otro proyecto ni se modificó producción, APEX, Estela o Bitflow.

## Resultado comprobado

- Dump PostgreSQL real del proyecto alojado, formato nativo custom; conexión directa IPv6 con TLS **verify-full**.
- Archivo de base y roles cifrados con **AES-256-GCM**. Los dumps sin cifrar pasan sólo por memoria. Los roles se exportan sin contraseñas.
- Clave de cifrado guardada en Windows Credential Manager, ligada a la referencia exacta del proyecto. No está en Git ni en el manifiesto.
- Hashes SHA-256, fecha, versión de herramienta, tamaños e inventario de alcance en el manifiesto.
- Restauración de la aplicación y los datos de Auth/Storage realizada en **dos bases separadas**, dentro del mismo proyecto Free de QA, sin crear otro recurso facturable.
- Ambas bases de ensayo tenían CONNECT público revocado. Se eliminaron después de verificar los resultados, conservando respaldos y evidencia.

### Comparación de los dos ensayos

| Comprobación | Resultado |
|---|---|
| 151 tablas: conteos y SHA-256 del contenido canónico | Coinciden con el origen |
| Estado RLS de tablas de la aplicación | Coincide |
| 74 políticas RLS: definiciones | Coinciden |
| Permisos efectivos de tablas/vistas/secuencias | Coinciden |
| 458 funciones: definición y permisos | Coinciden |
| Tablas de publicación supabase_realtime | Coinciden |
| Aplicación de 636 entradas ACL de la aplicación | Correcta |

La referencia de comparación es el origen al verificar, sin actividad comercial ni escrituras de QA concurrentes. El archivo cifrado conserva el snapshot original. La comparación normaliza los ACL implícitos del dueño mediante `acldefault`; no confunde una representación NULL con falta de permisos.

Datos de negocio en el snapshot: cero usuarios Auth, productos públicos, pedidos, intents y objetos Storage; **160 migraciones y 76 proyecciones históricas privadas**, incluidos los 72 productos. Las tablas no vacías y sus datos también se comprobaron por hash. No se inventaron usuarios ni historia comercial para enriquecer la prueba.

## Límite: no es una certificación de recuperación de toda la plataforma

El dump completo existe y está cifrado, pero el intento de restaurarlo íntegramente en otra base del mismo clúster encontró:

1. `pg_cron`: `can only create extension in database postgres`. Sólo puede operar desde la base configurada como principal del clúster.
2. Una función interna de Realtime: `permission denied to set parameter "log_min_messages"`.
3. Los default privileges de roles administrados, como supabase_admin, no pueden ser modificados con la cuenta postgres disponible.

No se cambió `cron.database_name`, no se elevaron privilegios y no se alteraron funciones internas del origen. Se usó un ensayo separado y explícito para los esquemas public, private, catalog_admin, supabase_migrations, auth y storage. Se restauraron los permisos de los objetos de la aplicación y sus default privileges de postgres; se excluyeron los defaults de roles administrados y los runtimes internos cron/Realtime/net/GraphQL/pgbouncer. La publicación lógica sí se reconstruyó y comparó.

**No están certificados** con este ensayo: reinicio completo de Auth/Storage/Realtime, propietarios internos administrados, motor de cron, recuperación de claves raíz de Vault ni un clúster Supabase nuevo completamente operativo. Una base auxiliar del mismo clúster no reproduce por sí sola esos servicios. La documentación oficial también distingue los objetos propios de los esquemas administrados: [backup y restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

No se propone un plan pago para resolverlo automáticamente. El ensayo completo requiere una plataforma Supabase aislada compatible. Docker no respondió a las consultas locales y C: se quedó sin espacio; no se reinició globalmente ni se descargaron imágenes pesadas.

## Recuperación reproducible

Código y dependencias existentes se conservaron en una copia de trabajo reducida en **D:/work/la-taba-free-review-20261020**. Las dependencias se copiaron desde C: sin descargarlas. Los commits previos se mantienen. La copia antigua de trabajo en C: no es el destino operativo de esta etapa.

Desde D:, con TEMP y TMP en D: y NODE_DISABLE_COMPILE_CACHE=1:

```powershell
node scripts/recovery/postgres-backup.mjs --backup --target deploy/recovery-free-hosted.json --tools D:/work/la-taba-backup-20261021/tools/package/native/bin --ca C:/Users/marco/.taba-secrets/production-db-ca.pem --out D:/work/la-taba-backup-20261021/NUEVO-SNAPSHOT

node scripts/recovery/restore-postgres-application.mjs --restore-application --target deploy/recovery-free-hosted.json --manifest D:/work/la-taba-backup-20261021/NUEVO-SNAPSHOT/manifest.json --tools D:/work/la-taba-backup-20261021/tools/package/native/bin --ca C:/Users/marco/.taba-secrets/production-db-ca.pem --out D:/work/la-taba-backup-20261021/NUEVO-ENSAYO

node scripts/recovery/verify-postgres-restore.mjs --verify --target deploy/recovery-free-hosted.json --receipt D:/work/la-taba-backup-20261021/NUEVO-ENSAYO/restore-result.json --tools D:/work/la-taba-backup-20261021/tools/package/native/bin --ca C:/Users/marco/.taba-secrets/production-db-ca.pem --out D:/work/la-taba-backup-20261021/NUEVA-VERIFICACION
```

Los nombres NUEVO-* deben ser directorios inexistentes. El restaurador crea un nombre único `taba_restore_YYYYMMDD_XXXXXXXX` y no acepta la base de origen como destino. Una restauración no implica verificación: ejecutar ambos comandos y revisar sus resultados. Una copia parcial fallida queda identificada en su recibo; no reutilizarla como si fuera una base limpia.

La limpieza posterior sólo se autoriza sobre la base creada por ese ensayo, con recibo y verificación concordantes. No usar DROP sobre postgres, template1, nombres históricos ni referencias de otros proyectos.

## Archivos y protección

- Directorio: `D:/work/la-taba-backup-20261021/`.
- Cada snapshot contiene `database.pgdump.aesgcm`, `roles.sql.aesgcm` y `manifest.json`.
- Evidencia extendida: verificaciones por tabla, fallos iniciales, procedencia de herramientas y limpieza.
- Sólo metadatos y resultados sin secretos se versionan. **Los dumps cifrados y las claves no se subieron al repositorio público.**
- Clientes PostgreSQL 17.10 extraídos por rangos HTTP de la distribución oficial EDB; no se descargó el ZIP completo de 334 MB. Binaries auxiliares fijados a @embedded-postgres/windows-x64 17.10.0-beta.17, con integridad SHA-512 comprobada, sin ejecutar scripts npm.

## Pendientes operativos antes del lanzamiento

1. Elegir con el responsable un destino externo cifrado para copias de base y un respaldo seguro de la clave; Credential Manager en esta máquina no es custodia externa.
2. Definir retención, frecuencia, alertas y automatización. Existe una herramienta manual comprobada; no se afirma que haya un backup diario programado.
3. Completar el ensayo de plataforma administrada independiente.
4. Preservar/configurar de forma segura los secretos Edge: el dump no recupera sus valores. Los objetos Storage requieren copia aparte cuando existan; en estos snapshots hay cero.

El respaldo de aplicación es recuperable y se probó. El plan de recuperación comercial completo y la custodia externa de claves siguen pendientes. No habilitar ventas sólo por este resultado.
