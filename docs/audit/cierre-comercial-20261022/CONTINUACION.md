# Continuación del cierre — 22/10/2026

Base remota confirmada: `36f24cab3bf020dc77ab39f72416d3cb91ab689f`, PR 148 en borrador.
Se continuó el mismo proyecto y checkout. **Se mantienen NO-GO técnico de producción y NO-GO comercial.**

## Corrección comprobada: alarma de respaldos con falso positivo

`backup-freshness.mjs` sólo leía metadatos: un manifiesto fresco con el dump eliminado seguía dando verde.
Una fecha futura y un límite NaN también suprimían la alerta. Se reprodujeron ambos defectos con pruebas
que fallaron antes del cambio.

Ahora la herramienta comprueba los dos archivos canónicos cifrados (dump y roles), sus SHA-256 y el proyecto
en sus sobres, sin leer claves ni descifrar. Rechaza archivos ausentes/corruptos, límites no positivos o no finitos,
reloj inválido y fechas con más de cinco minutos de adelanto. Una copia nueva corrupta dispara la alerta;
una anterior intacta no la oculta. `--project-ref` permite vigilar QA sin aceptar como sustituto el respaldo
de otro proyecto. No sigue rutas de archivo arbitrarias suministradas por el manifiesto.

Las pruebas iniciales recibieron archivos sintéticos cifrados completos para ejercitar el contrato nuevo;
sus aserciones de antigüedad/restauración se conservaron. Se agregaron controles negativos de pérdida de roles,
corrupción, mezcla de proyectos, sobres de otro proyecto y configuración inválida. Se limpian los temporales propios.
Esto verifica integridad y frescura, no custodia de clave ni capacidad de restauración de plataforma completa.

Validación sobre respaldos locales existentes de QA: integridad/frescura pasó; exigir restauración devolvió
exit 1 porque el manifiesto aún declara `restoreTestCompleted=false`. Se mantuvo esa alerta, sin alterar
el manifiesto para volverlo verde. No se subió ningún respaldo a un servicio externo.

## Mercado Pago oficial, sin operaciones financieras

Se consultó el MCP oficial para la aplicación de QA explícita `2691240967769590`:

- `quality_checklist`: 14 requisitos y 22 recomendaciones, todos revisados individualmente con evidencia de código
  en [MERCADO-PAGO-CALIDAD.md](MERCADO-PAGO-CALIDAD.md). Se documentaron también los campos ausentes;
  no se inventaron descriptor de vendedor ni datos personales para aparentar cobertura.
- `notifications_history`: una notificación fallida HTTP 502, sin éxitos en el período mostrado. Sin URL de destino
  ni zona horaria explícita; no atribuible al preview actual con la evidencia devuelta. Requiere comparación
  del titular con configuración y logs antes de concluir la causa. No se cambió el webhook a ciegas.
- Sin `quality_evaluation`: falta un ID reciente autorizado de prueba. Sin formulario de homologación,
  consulta de credenciales, OAuth, pagos, refunds ni cambios de cuenta.

## Compatibilidad del release

El dry-run del controlador existente aprobó: `mutations=0`, `production_checks=NOT_EXECUTED`, tres bundles
financieros construidos. Identidad de fuente: `3c792abaf956ebfc35178bf375260dd2566be7474d05ecad837c75fd48813e5a`.

La comparación **local**, sólo de definiciones, entre `compatibilityAt(spec,4)` histórico y el esquema limpio
de las 170 migraciones encontró 21 tablas modificadas/18 nuevas y 85 funciones modificadas/8 ausentes/180 nuevas.
Detalle: [release-schema-comparison.json](evidence/release-schema-comparison.json).
Incluye cambios esperables de migraciones posteriores; no demuestra drift en QA ni reemplaza un ensayo administrado.

`compatibility.json` se conservó. El controlador A1/A4 es un protocolo histórico de OLD → cuatro EXPAND → CONTRACT,
ligado a un proyecto productivo específico y a una base sin historia financiera. Su generador de compatibilidad
no adopta por sí solo todas las migraciones posteriores. No sería seguro sustituir sus huellas por las de una base
actual y declararlo apto para producción. Se necesita revisión del protocolo para la candidata final y regeneración
en la imagen administrada fijada, conservando los controles y revisando cada cambio.

Docker volvió a informar que no existe el pipe del daemon Linux. El disco de sistema sigue sin espacio libre;
no se intentó iniciar Docker ni borrar archivos ajenos. PostgreSQL nativo se utilizó sólo en el cluster local
propio, y sus stubs de servicios administrados se identifican como tales.

## Validaciones y bloqueos

- 108/108 pruebas focalizadas: respaldo, restauración y protocolo de release. Sin fallos ni omitidas.
- Ensayo offline del controlador: aprobado, sin llamadas de producción.
- Respaldo QA local: archivos/hashes/proyecto verificados; certificado de restauración pendiente.
- `get_project(ixewllzzuzpqrkxzmfzx)` volvió a ser denegado por Supabase. Sin consultas a la base alojada,
  migración aplicada, Edge desplegada ni canal alternativo para eludirlo.

Lo siguiente sigue requiriendo intervención: restablecer acceso al conector QA; habilitar un entorno administrado
de ensayo con espacio suficiente; consentimiento/MFA y autorización de los titulares para la ronda MP;
destino externo/custodio de clave y validación de catálogo y operación de Walter. La corrección de esta continuación
no requiere migración SQL ni despliegue del frontend. No hubo merge ni publicación productiva.
