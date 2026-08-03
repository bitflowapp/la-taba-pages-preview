# Recuperación, backup y continuidad

## Evidencia disponible en este release candidate

- SQLite usa WAL y el escritorio crea backups consistentes con `VACUUM INTO`,
  calcula SHA-256, ejecuta `quick_check`, verifica apertura read-only y audita
  resultado/tamaño.
- El arnés de base aislada aplica todas las migraciones, ejecuta pgTAP, genera
  un `pg_dump` binario, restaura en una segunda base y compara contratos y
  conteos críticos.
- En este host el restore drill PostgreSQL permanece `NOT_RUN` porque el daemon
  Docker no respondió. No existe evidencia de restore remoto ni de Storage para
  este HEAD.
- Por lo anterior, RTO y RPO de PostgreSQL, Storage y operación completa siguen
  `NOT_MEASURED`. Se deben medir en el proyecto aislado antes de certificar
  staging; no se asignan cifras nominales sin el ensayo.

## Evidencia obligatoria de cada drill

Registrar inicio, fin, responsable, fuente y destino aislado, HEAD, versión de
herramientas, hash del backup, tamaño, filas/objetos comparados, errores, pasos
manuales, tiempo real de recuperación y máximo intervalo de datos ausente.
Redactar project refs, usuarios y rutas privadas. Destruir sólo los recursos
temporales identificados por el propio drill y conservar el reporte.

## Backup local Windows

1. Desde Centro de operación solicitar backup local.
2. Confirmar estado `verified`, SHA-256, tamaño y `quick_check=ok`.
3. Conservar el archivo únicamente en el directorio privado permitido por
   Tauri; una copia externa debe usar medio cifrado y acceso mínimo.
4. No borrar la base activa, WAL o SHM para “reparar” una cola.
5. Verificar periódicamente un backup abriéndolo read-only mediante el comando
   de diagnóstico; la existencia del archivo no prueba restaurabilidad.

## Restore PostgreSQL aislado

1. Confirmar que Docker/Supabase local está saludable y que el destino es
   descartable, nunca producción.
2. Ejecutar `npm run test:db:isolated`.
3. El arnés crea nombres únicos, aplica las migraciones en orden, ejecuta el
   flujo de pago sintético y pgTAP, produce dump custom, restaura en otra base y
   compara la marca de drill y contratos críticos.
4. Conservar el reporte, hash y duración. Si falla, preservar logs sanitizados
   y no afirmar backup utilizable.
5. Para staging, repetir sobre una copia aislada autorizada con backup previo y
   sin datos humanos; no ejecutar el arnés mutante contra producción.

## Recuperación por incidente

### Pérdida de base o eliminación accidental

Congelar writers, workers y promociones; preservar logs y correlaciones;
identificar último backup probado y ventana de WAL/PITR disponible; restaurar
en proyecto aislado; verificar Auth, RLS, grants, constraints, conteos, pagos,
pedidos, stock, fiscales y hashes de objetos; recién después preparar una
promoción aprobada. Pagos y CAE posteriores al punto restaurado se consultan en
sus autoridades externas antes de reemitir acciones.

### Credencial comprometida

Revocar primero la credencial afectada, sesiones o dispositivo; rotar el
secreto en el gestor del entorno; desplegar de forma aprobada; invalidar caches
y revisar logs por uso desde la última fecha confiable. Access Token Mercado
Pago, webhook secret, service role, certificados y claves ARCA tienen rotación
independiente. No publicar el valor comprometido en tickets o commits.

### Edge Function caída

Marcar el servicio degradado, conservar requests idempotentes, pausar el tramo
que no puede confirmar autoridad y revisar logs por correlación. Restaurar la
misma versión aprobada o una corrección incremental; reconciliar preferencias,
webhooks y pagos antes de reabrir checkout.

### Pérdida de Storage fiscal

No alterar CAE ni metadata. Bloquear preview/descarga afectados, inventariar
objetos por `storage_path` privado y SHA-256, restaurar en bucket privado,
validar hash/tamaño/MIME y acceso RLS, o regenerar con owner/admin creando una
supersesión auditada. Una URL firmada nunca es backup.

### Aplicación Windows dañada o PC reemplazada

Preservar SQLite, WAL, SHM, spool y diagnóstico antes de desinstalar. Verificar
backup local read-only. Instalar el mismo artefacto firmado y comprobar hash;
restaurar sólo dentro del directorio permitido; iniciar sesión nuevamente;
reconciliar outbox e impresiones `unknown`. En PC nueva, revocar la sesión del
equipo anterior y no copiar secretos de máquina.

### SQLite corrupto

Cerrar la aplicación sin matar el proceso durante una escritura, copiar base,
WAL y SHM como evidencia, ejecutar diagnóstico read-only y probar el último
backup verificado en ubicación separada. No usar comandos destructivos sobre
el original. Reemplazar sólo tras comparar pendientes y obtener aprobación de
soporte; los estados autoritativos se recuperan de PostgreSQL.

### Teléfono Rider perdido

Revocar sesión y membership/dispositivo, bloquear reasignaciones desde ese
actor, rotar credenciales si existieran, reasignar entregas por CAS y auditar
GPS posterior a la pérdida. El teléfono no debe contener service role ni
secretos backend. Ver el runbook Rider versionado en su repositorio separado.

### Certificado ARCA vencido o próximo a vencer

Alertar antes del vencimiento, mantener ventas/pagos y fiscal outbox pendientes,
obtener certificado aprobado y relación WSAA/WSFE, validar homologación con la
confirmación separada y rotar en el worker privado. No copiar clave privada al
panel ni emitir a producción durante la validación.

### Access Token Mercado Pago rotado

Pausar creación de preferencias, mantener carritos/sesiones, rotar sólo en
secrets backend y ejecutar consulta/webhook de prueba. Reconciliar pagos
pendientes antes de reabrir. El gate productivo y el consentimiento de pago
real siguen siendo obligatorios y distintos.

## Responsabilidades

| Rol | Responsabilidad |
| --- | --- |
| Operador | detener el tramo, conservar estado y registrar correlación |
| Soporte L1 | diagnóstico sanitizado, clasificación y recuperación guiada |
| Responsable técnico | DB/Storage/workers/builds, reconciliación y rollback |
| Seguridad | revocación, rotación y revisión de acceso |
| Contador | política fiscal, retención y decisiones ARCA |
| Responsable comercial | catálogo/precio/stock, caja y aprobación de diferencias |

Los nombres de personas y guardias se registran en el sistema operativo del
piloto, no en el repositorio.
