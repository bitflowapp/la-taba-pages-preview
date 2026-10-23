# La Taba — entrega consolidada al 23/10/2026

El trabajo de implementación queda entregado como candidata QA en el
[PR 148](https://github.com/bitflowapp/la-taba-pages-preview/pull/148), que permanece en borrador.
**La apertura comercial y los cobros siguen pendientes.**

Esta entrega consolida el código de `71a044e4` y corrige el estado desactualizado del informe y del runbook.
No cambia código de aplicación, migraciones ni funciones. Los resultados alojados se identifican por su fecha;
no se presentan como una comprobación en vivo del 23/10.

## Implementación y QA registrados

- Ambas referencias al verificador, en negocios y productos, conservan atribución con FK `ON DELETE RESTRICT`,
  índices parciales y los CHECK originales. La migración `20261022233526` tiene aplicación QA registrada;
  ambos ledgers llegaron a 170/170.
- Los simulacros generan datos por ejecución, guardan un recibo y limpian transaccionalmente. La evidencia alojada
  muestra recuperación de un pedido sin descontar stock dos veces, backoff del worker interrumpido y una alerta
  visible para un pago pendiente sin vendedor conectado; ambos simulacros terminaron limpiando sus datos.
- `catalog-image-manager` v6 tiene despliegue QA y controles de acceso registrados; el frontend conserva v159.
- Respaldo y restauración comprueban archivos cifrados, proyecto, hashes y recibo ligado al archivo restaurado.
  La copia externa, custodia separada y restauración de todos los servicios administrados siguen pendientes.

La evidencia alojada proviene de la continuación publicada en `71a044e4` y de sus archivos guardados el
23/10 entre 01:59 y 02:20 UTC: [aplicación y preparación MP](QA-APLICACION-Y-PREPARACION-MP.md).
Incluye seis suites SQL con rollback y proveedor simulado, asesores con cero errores, los dos simulacros con
cron/Vault/HMAC/worker reales, aislamiento y verificaciones API. Los archivos privados permanecen fuera de Git.

## Verificación ejecutada en esta continuación

| Control | Resultado |
|---|---|
| Base PostgreSQL local construida desde el código de `71a044e4` | 170 migraciones, desde cero |
| Verificadores, limpieza tras interrupción, efectivo y adaptador pgTAP | 12/12 pruebas, sin omitidas |
| Integridad/frescura de respaldos, copia cifrada, recibos de restore, privacidad y preflight | 31/31 pruebas, sin omitidas |
| Consulta local de las dos FK | Ambas restrictivas y validadas |
| `npm run check` y diff | Aprobados: sintaxis, configuración, precache, identidad, higiene, ubicación, codificación y secretos |

Son **43 pruebas actuales**, distintas de las cifras históricas de las continuaciones anteriores.
PostgreSQL es real; cron/net/Vault locales utilizan los stubs del repositorio y no certifican los servicios alojados.
Los comandos y los límites quedan en [verification-20261023.json](evidence/verification-20261023.json).

La lectura actual `get_project(ixewllzzuzpqrkxzmfzx)` del conector Supabase fue denegada:
`You do not have permission to perform this action`. No se intentó otro canal para sortear esta denegación.
El estado alojado registrado anteriormente no equivale a una certificación de su estado actual.

## Lo que falta para habilitar cobros

| Pendiente | Intervención necesaria |
|---|---|
| Acceso actual a QA | Restablecer la lectura autorizada del proyecto exacto antes de nuevas operaciones |
| Redirección OAuth de prueba y PKCE | El titular de la app MP `2691240967769590` registra el callback exacto indicado en el runbook |
| Firma del webhook | El titular la obtiene del panel y la carga en QA mediante la herramienta existente, sin compartirla por chat |
| Vendedor y compras auténticas de prueba | Consentimiento/MFA del vendedor de prueba y ejecución autorizada de la matriz, incluidas devoluciones y conciliación |
| Recuperación ante pérdida de la PC | Copia externa, custodio de clave separado y restauración integral con RPO/RTO acordados |
| Apertura comercial | Walter valida catálogo y operación; revisión financiera independiente y compatibilidad del release final |

El último preflight guardado registró vendedor desconectado, ambiente `test` y falta de
`MERCADOPAGO_OAUTH_WEBHOOK_SECRET`. Un webhook que devuelve 503 por falta de firma no aprueba la prueba
de autenticidad; debe rechazar firmas falsas con 401 una vez configurado. El circuito auténtico no puede
certificarse con simulaciones ni completarse inventando secretos o consentimiento.

Los pasos y criterios exactos están en [RUNBOOK.md](RUNBOOK.md) y
[QA-APLICACION-Y-PREPARACION-MP.md](QA-APLICACION-Y-PREPARACION-MP.md).
Se mantienen el borrador del PR y los NO-GO técnico de producción y comercial. Esta continuación no ejecutó
pagos, OAuth, devoluciones, despliegues, merge ni cambios en la cuenta de Walter.
