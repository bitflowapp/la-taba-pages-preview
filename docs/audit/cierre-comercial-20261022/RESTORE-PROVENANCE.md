# Evidencia de restauración ligada al archivo

Continuación sobre `e28841e8`, 22/10/2026. No se modificaron esquemas ni servicios alojados.

## Defecto reproducido y solución

La verificación anterior comparaba la copia restaurada contra la base **viva al verificar**, no contra una
referencia del archivo utilizado. Se reprodujeron dos consecuencias con pruebas rojas:

- Una restauración fiel se rechazaba si la base viva había avanzado después del backup.
- Una copia modificada para coincidir con datos más nuevos podía aprobar la comparación del backup original.

Ahora cada nueva restauración produce un recibo versión 2 con un UUID de ejecución, hashes SHA-256 del archivo
cifrado y del dump descifrado, y fecha autenticada del sobre AES-GCM. Se valida la autenticidad del sobre con la clave
ya custodiada; el dump debe ser formato PGDMP. Los buffers explícitos de clave y dump se ponen a cero al salir,
también si falla la preparación de archivos de evidencia.

La base aislada recibe una marca con ejecución/hash. Al finalizar pg_restore y los ACL de aplicación se guarda
`restored-archive-fingerprints.json`, ligado al recibo por su SHA-256. Sus huellas se capturan en una transacción
repeatable read: filas, tablas, RLS, políticas, permisos, funciones y publicación. No contienen filas en claro.

El verificador exige recibo completo, proyecto QA correcto, fases aprobadas, archivo de huellas íntegro y marca
de base concordante **antes de comparar datos**. Recibos incompletos, fallidos, antiguos o mezclados entre runs
no establecen evidencia. Se mantiene la exclusión expresa de `taba_restore_20261022_ad3d29a2` en las herramientas;
esa base no fue leída, cambiada ni eliminada por esta continuación.

`allApplicationChecksPassed` compara ahora con la referencia capturada tras restaurar el archivo identificado.
`liveComparison` y `liveSourceMatchesRestored` informan separadamente los cambios de la base viva. Que ésta haya
avanzado no modifica la evidencia del archivo; que una copia coincida con ella tampoco certifica el archivo antiguo.

La referencia depende del procedimiento de restauración controlado y del recibo privado. No pretende defender
contra un administrador que altere deliberadamente base, recibo y evidencia a la vez. Sigue sin certificar
servicios administrados, bytes de Storage, custodia externa de claves ni pagos auténticos.

## Protección de archivos privados

La regla previa de escribir sólo en D: era insuficiente: este checkout también está en D:.
Backup PostgreSQL, restauración, verificación y paquete de copia externa ahora rechazan una salida dentro de
cualquier directorio Git/worktree, incluso si la ruta final todavía no existe. Se resuelve el ancestro existente
para detectar rutas que atraviesen enlaces de directorio. Las evidencias nuevas se crean con permisos privados
en plataformas que los aplican, sin sobrescribir resultados anteriores.

Las negativas se prueban antes de leer credenciales, conectarse o crear archivos. No se eliminaron enlaces,
datos ajenos ni archivos existentes para implementar este control.

## Pruebas ejecutadas

- 136/136 pruebas Node focalizadas de recuperación, respaldos y protocolo de release, sin fallos ni omitidas.
- Prueba PostgreSQL nativa adicional: pg_dump completo de una base local sintética, pg_restore en otra base
  descartable, comparación de todas las huellas, avance de la fuente y reemplazo de la copia con un dump más nuevo.
  La copia fiel conserva su resultado y el reemplazo posterior falla para el archivo original.
- La prueba usa exclusivamente bases `taba_local_*` en loopback y limpia sus dos bases propias. No usa ninguna
  base `taba_restore_*` real ni accede a un servicio alojado.
- Los controles de manipulación de recibo, cambio de archivo/run/proyecto y pérdida de evidencia también pasan.

## Cómo verificar una restauración nueva

Con acceso QA autorizado y respaldo/clave disponibles, usar los mismos comandos, con salidas privadas nuevas:

```text
node scripts/recovery/restore-postgres-application.mjs --restore-application --target deploy/recovery-free-hosted.json --manifest <snapshot>/manifest.json --tools <bin-postgres> --ca <certificado-publico> --out <directorio-privado-nuevo>
node scripts/recovery/verify-postgres-restore.mjs --verify --target deploy/recovery-free-hosted.json --receipt <directorio-privado-nuevo>/restore-result.json --tools <bin-postgres> --ca <certificado-publico> --out <otra-salida-privada-nueva>
```

Conservar juntos el recibo y `restored-archive-fingerprints.json`. Un recibo anterior sin ese vínculo no debe
editarse para aparentarlo: hace falta otro ensayo aislado con la herramienta actual, una vez autorizado el acceso.
Los manifiestos de backup no se marcan automáticamente como restaurados. La comparación de aplicación no cambia
`fullManagedPlatformRestorePassed=false` ni concede GO comercial.

## Acceso a Supabase

Se inspeccionó el ajuste del conector: tiene una excepción específica de **Allow all actions**, por encima del
valor global **Allow low-risk actions**. No se modificó. Ese ajuste no explica por sí solo la denegación previa
del servicio para QA ni demuestra permisos de la cuenta OAuth sobre el proyecto.
Se pidió reconectar y comprobar acceso al proyecto exacto, sin pedir claves. No se intentó otro canal de datos
para eludir la denegación. La validación alojada y el ensayo administrado siguen pendientes de ese acceso.

**Se mantienen NO-GO técnico de producción y NO-GO comercial.** Sin OAuth de vendedor, pagos, reembolsos,
despliegue productivo ni merge. Los controles de recuperación preparados requieren todavía su corrida autorizada
en QA y la validación de custodia/restauración externa.
