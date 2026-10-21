# Continuación: infraestructura alojada de La Taba

> Informe histórico. La propuesta paga fue rechazada. El estado actual está en
> [recuperación a costo cero](2026-10-20-free-recovery-status.md).

**Estado: paquete preparado; creación alojada pendiente de costo autorizado.**
No se creó infraestructura ni se ejecutó un checkout alojado. Los pagos
comerciales siguen sin autorización y no se realizó ninguna transacción real.

## Supabase original y destino

Las consultas autenticadas al Management API volvieron a devolver HTTP 404 y
`Resource has been removed` para producción, staging y piloto. El conector
tampoco da acceso. La documentación actual dice que un proyecto eliminado y
sus backups alojados no se pueden recuperar. Si hubo un traslado en lugar de
una eliminación, sólo el propietario puede restituir acceso a la organización
correspondiente. No se dispone del audit log que determine fecha o autor.
[Eliminación de proyectos](https://supabase.com/docs/guides/platform/delete-project).

Destino propuesto: **la-taba-recovery-test**, organización **Luna Systems**,
región **sa-east-1 / São Paulo**. La organización tiene plan Pro y la herramienta
de Supabase cotizó **USD 10 mensuales adicionales** para el nuevo proyecto.
El usuario autorizó explícitamente sólo USD 0 y usar credenciales para pruebas.
Por eso no se llamó a confirm_cost ni create_project. Se presentó por separado
la autorización de USD 10/mes; permanece pendiente al escribir este informe.

El ref y createdAt en `deploy/recovery-test.template.json` están vacíos
intencionalmente: no representan un proyecto creado. El origen de checkout
del archivo es una propuesta de preview, no un sitio publicado. La aplicación
productiva de MP y los proyectos ajenos no se modificaron.

## Preparación implementada

- Se preservaron las correcciones previas en el commit `ac9ed825`, en la rama
  `audit/supabase-payments-recovery-20261020`. No se hizo push ni merge.
- `2026-10-20-hosted-recovery-plan.json` enumera las **159 migraciones** en
  orden, con SHA-256, y los grafos de archivos de las **13 Edge Functions**,
  conservando su política JWT. No se copiaron assets ni dependencias pesadas.
- `scripts/recovery/bootstrap-hosted.mjs` tiene modo de planificación por
  defecto. Para escribir exige un recibo explícito del proyecto nuevo y
  `--apply`; verifica nombre, organización, región, fecha, estado y ref contra
  Supabase. Rechaza los refs conocidos de La Taba y de los otros proyectos.
- El arranque de esquema rechaza bases con datos/usuarios preexistentes;
  pausa cron en la misma transacción de cada migración y conserva dos ledgers
  coherentes para reanudar sin reejecutar versiones ya registradas. Una
  diferencia de SQL o de historial aborta. No ejecuta `supabase/seed.sql`.
- La primera migración histórica incluye un negocio semilla. El plan lo
  identifica como semilla del repositorio, no como historia recuperada, y el
  cierre del bootstrap deja pedidos y pagos deshabilitados. No se borran datos.
- Auth está especificado en el manifiesto: ingreso anónimo para el cliente,
  email con confirmación, contraseña mínima 12 y JWT 1 hora. Falta configurar
  y verificar esos valores en el proyecto nuevo, junto con templates y origen.
- RLS, relaciones, buckets/políticas de Storage y publicaciones Realtime
  están en las migraciones. Su aplicación y verificación remotas están
  pendientes. Los archivos originales de Storage no aparecen en el respaldo.
- El binding nuevo de OAuth es exclusivo de **staging/test** y de
  **TABA2 Staging**. Rechaza la app productiva, refs históricos, orígenes de
  producción y la autorización de cobros reales. No reemplaza los bindings
  productivos existentes ni habilita un modo genérico para cualquier proyecto.
- Se fijaron dos imports backend de Supabase que estaban en `@2` a la versión
  `2.110.8` ya usada y bloqueada en el repositorio, sin instalar paquetes nuevos.

La preparación del transporte SQL y de sus guardas está probada con fixtures.
**Todavía no se ejecutaron las 159 migraciones contra PostgreSQL alojado**;
los tests de transporte no certifican que todo el SQL sea compatible con una
instancia nueva. Tampoco se reutilizó ni ejecutó el protocolo productivo V5,
que sigue ligado al ref original: su revisión de bindings queda pendiente
para cualquier futura operación productiva.

## Datos recuperables, sin fabricar historia

El archivo privado de septiembre mantiene su hash original. El análisis
detallado está en `2026-10-20-recoverable-data.json`:

| Material | Cantidad | Tratamiento preparado |
|---|---:|---|
| Negocio histórico parcial | 1 | Preservación privada con procedencia |
| Proyecciones de productos | 72 IDs únicos | Preservar todos los valores originales; no publicar |
| Resúmenes agregados de pedidos | 3 | Conservar como agregados, nunca convertirlos en pedidos |
| Usuarios, pedidos completos, ítems, pagos y OAuth | No incluidos | No reconstruir filas inexistentes |
| Objetos de Storage | No incluidos | Buscar una copia externa; no afirmar recuperación |

Los 72 productos conservan su precio como string original. Todos carecen de
business_id y de los hashes de assets que exige el catálogo comercial actual;
no se asignan esos datos por suposición. El stock es un valor histórico sin
frescura verificada. La fase `quarantine` prepara **76 registros fuente** en
una tabla privada con RLS y revocaciones para anon/authenticated/service_role,
hash de backup y de cada fila. No inserta en el catálogo público ni en Auth,
pedidos o transacciones. **La carga real aún no se ejecutó.**

## Mercado Pago: comprobaciones reales y límites

Se usó sólo la aplicación **TABA2 Staging (`2691240967769590`)** con la
autorización del usuario para credenciales de prueba. El conector devolvió
la credencial de prueba y el chequeo **GET /users/me** respondió HTTP 200,
`site_id=MLA` y tag `test_user`. Los valores no viajaron en argumentos, logs,
archivos ni commits; la respuesta sensible del conector se descartó después
de seleccionar los campos de prueba necesarios, que quedaron sólo en memoria.
No se accedió a las credenciales de La Taba Delivery.

El historial de notificaciones de TABA2 Staging reportó una notificación,
fallida con HTTP 502, tópico `topic_merchant_order_wh`, con intento informado
el 17/10/2026 a las 13:20, sin zona horaria indicada. No se infiere a partir de
ese dato qué servidor contestó ni que sea una prueba del circuito actual.

La autenticación del token de prueba está verificada. Siguen pendientes:
autorización OAuth del vendedor de prueba, callback en el proyecto nuevo,
firma/entrega de webhooks, idempotencia contra proveedor alojado, pago de
prueba, confirmación única del pedido, stock, cancelación y reembolso de prueba.
Las tres correcciones financieras anteriores se conservan y pasan sus
regresiones locales; eso no sustituye un checkout real con cuentas de prueba.

## Pruebas de esta continuación

| Prueba | Resultado | Evidencia / límite |
|---|---|---|
| Node: pagos e inventario/arranque/recuperación | 221 PASS, 0 fallas | 205 existentes y 16 de recuperación; transporte alojado simulado |
| Edge/Deno | 250 PASS, 0 fallas | Red denegada; incluye 21 controles nuevos de aislamiento de recuperación |
| Node ejecutados por el runner de webhooks | 12 PASS | Subconjunto repetido, no sumar como cobertura independiente |
| Acceso fiscal y agente de impresión | 7 PASS | Tests de esas superficies backend después de fijar el SDK |
| Tipos de las dos funciones con SDK fijado | PASS | Deno check con --no-remote y node-modules-dir=none |
| Nueve controles de check | PASS tras corregir una ruta local en documentación | Sintaxis, configuración, assets, precache, higiene, identidad, ubicación, encoding y secretos |
| Identidad MP de prueba | HTTP 200, test_user, MLA | Consulta externa real de sólo lectura |
| Checkout completo alojado | NO EJECUTADO | No existe aún el proyecto de destino |

No se repitió el navegador con fixtures de la etapa anterior ni se descargaron
navegadores. D tiene unos 400 MB libres: suficientes para logs pequeños, no
para reconstruir un stack. Su raíz rechazó crear una carpeta; se pudo usar
el directorio existente `work`, donde se guardaron los logs de esta etapa
en `la-taba-recovery-evidence-20261020`. C tenía unos 149 MB al inicio.
No se borraron archivos personales, datos de proyectos ni caches anteriores.

## Siguiente ejecución y autorización pendiente

Si se autoriza el costo, crear el único proyecto indicado, guardar su recibo
de identidad y completar el target. Luego:

1. Aplicar las migraciones desde el manifiesto y verificar tablas, grants,
   RLS, advisories, publicaciones, buckets y ausencia de pagos activos.
2. Cargar las 76 proyecciones sólo en cuarentena privada y comparar hashes.
3. Configurar Auth, secretos de prueba, preview del frontend existente sin
   cambiar su diseño/precios, y desplegar las 13 funciones con el JWT previsto.
4. Registrar callback y webhook exclusivamente en la app de pruebas; conectar
   un vendedor y comprador de prueba verificados. Crear identidades QA nuevas
   y rotuladas como tales, sin presentarlas como usuarios históricos recuperados.
5. Recorrer cliente → carrito → checkout → MP de prueba → webhook firmado →
   consulta autoritativa → un pedido → panel → un efecto de stock; repetir
   eventos y probar abandono, pendientes, rechazos, expiración, cancelación y
   reembolso de prueba. Comparar filas y eventos antes/después.

No se escriben secretos en el target o manifiesto. El bootstrap no crea
proyectos ni obtiene sus API keys. Se usa con archivos nuevos de recibo:

```powershell
node scripts/recovery/bootstrap-hosted.mjs
node scripts/recovery/bootstrap-hosted.mjs --apply --phase schema --target <recibo.json> --manifest docs/audit/2026-10-20-hosted-recovery-plan.json
node scripts/recovery/bootstrap-hosted.mjs --apply --phase quarantine --target <recibo.json> --manifest docs/audit/2026-10-20-hosted-recovery-plan.json --backup <json-privado-original>
```

**¿Podemos habilitar pagos reales de forma segura? No.** Falta infraestructura
alojada y evidencia del circuito con el proveedor. No se habilitará producción
por completar estas pruebas: la aprobación comercial/productiva es posterior
y separada. El único permiso económico solicitado ahora es el proyecto de
pruebas cotizado a USD 10/mes.
