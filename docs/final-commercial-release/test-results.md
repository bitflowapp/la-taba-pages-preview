# Resultados de pruebas

> Snapshot histórico: las cifras de esta tabla pertenecen al corte original de
> esta evidencia y no describen la validación vigente del candidato. La
> preparación actual vuelve a ejecutar los gates y registra sus totales en el
> informe final; el repositorio contiene actualmente 17 migraciones versionadas.

## Suite final local

| Comando o validación | Resultado |
| --- | --- |
| `npm run check` | PASS |
| `npm test` | PASS — 444/444 |
| `npm run test:e2e` | PASS — 53/53 |
| `npm audit --audit-level=high` | PASS — 0 vulnerabilidades |
| `git diff --check` | PASS |
| `npm run migrations:validate` | PASS — 12 migraciones en este snapshot histórico |
| `npm run catalog:template:validate` | PASS — plantilla válida, 0 filas comerciales |
| `npm run catalog:images:verify -- --allow-empty` | PASS — pipeline válido, 0 packshots comerciales aprobados |
| `npm run vendor:build` | PASS |
| QA visual round 1 | PASS — 84/84 |
| QA visual round 2 final | PASS — 84/84 |
| Videos de flujo | PASS — 3 WebM generados y revisados |

La suite unitaria incluye contratos de roles, RLS/migraciones, repositorios,
DTO público, token inválido/vencido, GPS fresco/vencido, asignación CAS,
reasignación, código de entrega, catálogo, importación y autoridad de
publicación. Una revisión focal independiente ejecutó además 66 pruebas de
catálogo/tracking/seguridad sin fallas.

La suite E2E cubre cliente → negocio → rider → tracking → entrega, checkout con
y sin alcohol, delivery/retiro, búsqueda y recuperación sin resultados, estados
sin GPS, GPS real del preview, tracking entregado, privacidad previa a aceptar,
código y comprobante de entrega, responsive 320–1280, consola, rutas locales y
service worker.

La primera pasada final E2E detectó en 320×700 que el toast de producto
agregado podía interceptar el toque sobre la CTA persistente del carrito. Se
eliminó la captura de eventos del aviso, se revalidó el caso focal y se repitió
la suite completa: 53/53 aprobadas.

## Gates fail-closed esperados

`npm run catalog:release:validate` se rechaza deliberadamente mientras no exista
un archivo comercial aprobado indicado por argumento o `TABA_CATALOG_FILE`.

Eso vale para el RELEASE, que es donde ese archivo existe: `npm run verify` y
`npm run release:folder` la siguen corriendo con sus dientes puestos. En CI, en
cambio, correrla a secas la ponía a fallar en cada PR por un artefacto que esa
rama no tiene por qué traer, y con ella se caía el job entero. Desde el
2026-08-23 CI corre `npm run catalog:release:ci`, que corre la compuerta cuando
hay catálogo, falla si la variable está mal escrita, y cuando no hay deja
escrito en el log que NO corrió y qué quedó sin validar. No es un `|| true`: un
verde de CI no afirma que el catálogo comercial esté validado, y lo dice.
`npm run staging:validate` valida archivos, migraciones y plantilla, y luego se
rechaza porque este host no recibió runtime de staging ni catálogo/imágenes
reales. Estos rechazos son el comportamiento de seguridad esperado, no una
caída de la suite local.

## Límite verificable

No hay `psql`, Docker, Supabase CLI ni credenciales de staging en este entorno.
Por eso las migraciones y políticas se validaron estáticamente y por tests, pero
no se aplicaron contra una base externa. No se inventó un resultado de RLS en
staging.
