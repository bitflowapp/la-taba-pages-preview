# Evidencia de validación de la base productiva TABA

Fecha: 25 de julio de 2026
Repositorio: `C:\1212\la-taba-pages`
Rama: `feat/taba-production-beverages`
HEAD base sin nuevos commits: `333b5a2c5016afb0383ce409c2c381e54d93fcf9`

## Veredicto

La implementación local y el artefacto estático pasan sus controles automatizados,
pero **TABA no está certificada ni autorizada para producción**. No se aplicaron
migraciones en PostgreSQL/Supabase, no se ejecutó el smoke mutante real, no se
inyectó una runtime config y no se hizo despliegue.

## Preservación y trazabilidad

- Backup externo verificado:
  `C:\1212\la-taba-pages-backup-pre-production`.
- Ventana de copia: `2026-07-25T02:29:35.7244036-03:00` a
  `2026-07-25T02:29:44.3015132-03:00`.
- Resultado: 520 archivos, 138.208.104 bytes, cero faltantes, extras,
  diferencias de tamaño o diferencias SHA-256.
- Los 199 archivos no rastreados inventariados antes de implementar siguen
  presentes: 199/199, cero faltantes.
- No se ejecutaron `reset`, `clean`, checkout destructivo ni eliminación de
  cambios locales.
- `git fsck --no-progress --no-dangling`: aprobado.

Durante la ejecución, el volumen `C:` quedó sin espacio. Para preservar datos se
copió y verificó `.dart_tool` en:

- `E:\taba-backups\la-taba-pages-20260725-enospc\verified-copy\mobile\ojo_claro\.dart_tool`;
- `E:\taba-backups\la-taba-pages-20260725-enospc\relocated-original\mobile\ojo_claro\.dart_tool`.

También se reubicaron de forma recuperable `.git` y `node_modules`; dentro del
repositorio son junctions hacia:

- `E:\taba-backups\la-taba-pages-20260725-enospc\relocated-runtime\git-dir`;
- `E:\taba-backups\la-taba-pages-20260725-enospc\relocated-runtime\node_modules`.

## Entorno de validación

- Node.js `v24.8.0`.
- npm `11.6.0`.
- Python `3.11.9`.
- Playwright `1.60.0`.
- `@supabase/supabase-js` `2.110.8`.
- esbuild `0.28.1`.

No están disponibles Supabase CLI, Docker, `psql`, un proyecto de staging,
credenciales de prueba ni una configuración CI versionada.

## Resultados locales

| Control | Resultado |
| --- | --- |
| `npm run vendor:build` | Aprobado; bundle local generado |
| `npm run check` | Aprobado |
| `npm test` | 344/344 aprobadas |
| `npm run test:e2e` | 45/45 aprobadas |
| `npm audit --audit-level=high` | 0 vulnerabilidades |
| `git diff --check` | Aprobado |
| Marcadores de doble codificación en el alcance nuevo | 0 |
| Guard de `npm run smoke:supabase` sin confirmación | Aprobado; bloqueó antes de conectar |
| Smoke Supabase real | **No ejecutado** |
| Migración/RLS/transacciones en PostgreSQL real | **No ejecutadas** |

Una primera corrida E2E terminó 44/45 porque una aserción heredada exigía el
estado “Recibido” para un pedido de muestra que explícitamente no se envía al
local. Se actualizó esa expectativa para conservar la verdad del modo demo, el
caso dirigido pasó 1/1 y la corrida completa posterior pasó 45/45.

Playwright bloquea service workers en la configuración actual. Los tests PWA
validan estructura, rutas, assets, fallback y aislamiento de caches, pero no
reemplazan una prueba real de instalación, actualización y offline en staging.

## Dependencias remotas

Leaflet `1.9.4` quedó fijado con `crossorigin` y SRI. Los hashes se verificaron
contra los bytes HTTPS servidos:

- CSS: `sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=`;
- JavaScript: `sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=`.

El service worker sólo elimina caches con prefijo `la-taba-runtime-`; no elimina
caches ajenos del mismo origen. Una falla de precache impide instalar la versión
incompleta.

## Artefacto `dist_release`

El artefacto anterior estaba incluido en el backup externo. El generador actual
valida primero las fuentes, construye en una carpeta temporal y sólo después
reemplaza el destino, con restauración del artefacto anterior ante un error de
renombrado.

Resultado del artefacto generado:

- alcance: sólo runtime web; documentación y auditorías quedan en el repositorio;
- archivos esperados: 80;
- archivos presentes: 80;
- tamaño: 2.341.399 bytes;
- faltantes: 0;
- extras: 0;
- diferencias SHA-256 fuente/artefacto: 0;
- temporales residuales: 0;
- SHA-256 del manifiesto ordenado de archivos:
  `d28718a0046b6f3ed39eb53aca49710c13a2b8930bf7cc76859b23b00134debf`.

`dist_release/runtime-config.js` existe y coincide con la fuente, pero está
intencionalmente vacío/comentado. El artefacto falla cerrado hasta que un
pipeline autorizado inyecte únicamente URL, publishable key pública y UUID de
staging. El navegador y el smoke rechazan claves `sb_secret_`, roles JWT
privilegiados y formatos `sb_` no publicables.

## Gates pendientes

Antes de habilitar pedidos reales se debe:

1. disponer de staging aislado, backup restaurable y rollback probado;
2. aplicar todas las migraciones y ejecutar la matriz real de Auth, RLS,
   idempotencia, concurrencia, stock, cancelación y Realtime;
3. implementar rate limiting/CAPTCHA, cupos de reserva y liberación automática
   para impedir abuso de Auth anónima y agotamiento artificial de stock;
4. reemplazar el acceso directo de riders no asignados y tokens públicos por
   vistas/RPC con DTO mínimos, rotación/revocación y retención definida;
5. validar el catálogo real de bebidas, precios, stock, imágenes con derecho de
   uso y condiciones operativas con el comercio;
6. resolver política de alcohol/edad, privacidad, retención y consentimiento GPS;
7. agregar throttling y detección servidor para coordenadas GPS; la hora ya es
   autoritativa, pero una coordenada del navegador sigue siendo declarativa;
8. invalidar o volver a auditar verificaciones comerciales cuando cambien campos
   maestros;
9. inyectar runtime config de staging, CSP y observabilidad sin secretos;
10. probar PWA con service worker habilitado, subruta real, actualización,
    offline/error e iconos PNG compatibles;
11. ejecutar el smoke mutante en staging y conservar evidencia redacted;
12. obtener aprobación humana explícita antes de evaluar un rollout limitado.
