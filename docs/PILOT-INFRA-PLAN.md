# La Taba · infraestructura reproducible del piloto

**STATUS: WAITING_CATALOG_APPROVAL.** Este documento prepara la secuencia; no
crea recursos ni autoriza un deploy. Producción, Staging QA y DEMO no son
destinos válidos. No configurar ni usar Mercado Pago en PILOTO.

## Identidades y artefactos

| Superficie | PILOTO previsto | Compuerta |
|---|---|---|
| Backend | Proyecto Supabase nuevo en `sa-east-1`, misma organización de La Taba, ref nuevo | Distinto de `ucbtjcurawxjwjdvvcvj`, `wwcpogltfgzgkrlilbcd` y `yakhtrkukqlgzvxuvhzs` |
| Web | Proyecto Cloudflare Pages Direct Upload `la-taba-commercial-pilot`, alias `https://la-taba-commercial-pilot.pages.dev/` | `deploymentEnvironment=pilot`, URL cliente y `/#business` mismo host |
| Rider | `com.lataba.rider.pilot`, vName `0.1.3-canonical-pilot`, vCode `4` | `--target pilot --project-ref <nuevo-ref>`, certificado del backup OneDrive |
| Pago | Manual (`cash`/transferencia según operación) | No MP, sin intents/refunds de MP |
| Catálogo | 5–10 SKU aprobados de `catalog/pilot-approved-template.json` | Sin precio histórico ni producto DEMO/QA |

Los IDs/URL definitivos se completan en una copia de
`deploy/pilot-environment.template.json`. La copia de la aprobación se guarda
fuera del repo, en un directorio privado con ACL restringida. No guardar el
mensaje comercial completo ni credenciales en Git o artifacts.

## Secuencia bloqueada por aprobación

1. Interpretar la respuesta comercial con
   `reconcilePilotOwnerReply` de `scripts/import-pilot-catalog.mjs`. Es una
   ayuda de lectura, **no** genera aprobación. Registrar sólo SKU inequívocos,
   precio vigente, stock inicial, descripción factual, publicación sí/no y
   confirmación de nombre/categoría/foto. Exigir 5–10 `publish=true` y una
   referencia privada a la respuesta del dueño. Rechazar texto ambiguo.
2. Ejecutar el importador en `--dry-run` con esa copia. El template committeado
   está deliberadamente incompleto y debe fallar. No usar `catalog/products.csv`
   como fuente del piloto: sólo contiene dos de los diez SKU propuestos. Los
   datos técnicos históricos vienen de `production-catalog-snapshot.json` y
   la foto/derechos/hash de `docs/catalog/image-manifest.json`; los precios y
   stocks vienen exclusivamente de la aprobación.
3. Consultar costo/cuota disponible antes de crear **un proyecto nuevo**. Si
   implica una decisión financiera irreversible, detenerse. Crear sólo
   `la-taba-commercial-pilot` en la región anterior y guardar ref/DB password
   en almacenamiento local seguro; jamás apuntar al proyecto de Producción.
4. Aplicar las **133 migraciones** del repo al proyecto nuevo, sin seed QA ni
   fixtures DEMO. El CLI presente es `supabase` 2.117.0. Usar explícitamente
   `--project-ref <nuevo-ref> --skip-vault`; primero `db push --dry-run`, revisar
   la lista, luego `db push`. No cambiar el link local de Staging. Confirmar
   historia de migraciones y ejecutar advisors. Un rollback DB es forward-fix
   o migración compensatoria probada, no `reset`.
5. Configurar Auth con URL del nuevo proyecto Pages y redirecciones sólo de
   PILOTO. Deshabilitar autorregistro masivo; aprovisionar 1 owner, hasta 3
   riders y clientes QA/invitados controlados. No confiar en `user_metadata`
   para roles; comprobar `business_members`, `identity_user_security`, sesión
   `panel_web`/`rider_android` y RLS desde usuarios distintos. Si el SMTP del
   proyecto nuevo no permite templates, usar onboarding controlado; no abrir
   signup público para compensarlo.
6. La migración crea el bucket privado `fiscal-documents` con política de
   servicio. Confirmar que no sea público. Las fotos del catálogo son assets
   WebP auditados empaquetados en Pages, no un bucket público improvisado.
   No desplegar funciones MP; la única función no-MP existente es
   `fiscal-artifact-access`, a desplegar sólo si el flujo fiscal del piloto lo
   requiere y sus secrets están disponibles.
7. Guardar únicamente claves apropiadas: publishable key PILOTO en Credential
   Manager (`PILOT SUPABASE PUBLISHABLE KEY`, usuario = ref), token owner de
   sesión corta (`PILOT OWNER ACCESS TOKEN`) para importación, credenciales QA
   por actor, y clave privilegiada PILOTO sólo para limpieza administrativa
   local (`PILOT SUPABASE SECRET KEY`). Nunca poner clave privilegiada en
   runtime web/APK. Cloudflare account/token provienen del entorno privado del
   job de deploy. Ningún secret MP es requisito para este piloto.
8. Completar la configuración PILOTO. `pilot-preflight.mjs` es obligatorio:
   exige ref/negocio nuevos, allowlist aprobada, secrets presentes, host Pages
   dedicado, pago manual y Rider pilot apuntando al mismo backend. El apply del
   importador llama el preflight de nuevo; no acepta una variable de entorno
   que diga simplemente “PASS”. Importar por `import_catalog_batch` (oculto,
   atómico), verificar cada ficha por `publish_catalog_product` y activar la
   venta por `set_commercial_product_publication`; compensar por
   `unpublish_catalog_product` si falla una fila. Nunca escribir estados por
   SQL. Comprobar que los SKU públicos son exactamente los aprobados.
9. Construir y firmar Rider v4 con `build-rider-pilot.mjs --target pilot
   --project-ref <nuevo-ref> --version-code 4 --version-name
   0.1.3-canonical`, y repetir con `--android-test` para el test físico
   firmado. El build sólo lee firma/contraseña de fuera del repo y genera un
   receipt sin secretos; preflight compara ref, versión, package, hash de APK
   y certificado. Instalar en Moto sólo la v4 PILOTO y su test package tras
   un ADB PASS. Conservar la APK v3 y la primera v4.
10. Con checkout limpio, ejecutar `prepare-commercial-pilot.mjs` para generar
    `dist_pilot` con runtime y metadata (ref, negocio, allowlist y hash de
    migraciones). Ese script no despliega. El deploy Pages posterior debe usar
    sólo el proyecto dedicado y su rama productiva `pilot`. Registrar commit,
    runtime, deployment ID y URL; no fusionar a main para publicar.
11. Ejecutar `smoke-commercial-pilot.mjs` con la **misma** aprobación privada:
    compara SKU, precio, imagen y stock positivo desde la clave pública, y
    abre cliente/panel en Chromium y WebKit. Luego ejecutar el runner físico
    `run-commercial-pilot-e2e.mjs` con Moto G15, cuentas QA y APK v4. No crear
    pedido si el preflight, runtime público, allowlist o ADB falla.
12. Con dos deployments compatibles y una APK PILOTO anterior conservada,
    ejecutar `drill-commercial-pilot-rollback.mjs`: preflight read-only,
    rollback web+config al deployment previo, verificar backend/metadata/hash
    de migraciones, y restaurar el candidate. No ejecutar ahora: no existe el
    proyecto PILOTO.

### Comandos del operador técnico, sólo después de aprobación

Los valores entre `<...>` salen del proyecto nuevo o de rutas privadas; nunca
son Staging ni Producción. El archivo aprobado y el manifiesto real quedan
fuera de Git. Los comandos no imprimen claves ni contraseñas.

```powershell
node scripts/import-pilot-catalog.mjs --target pilot --project-ref <nuevo-ref> --business-id <nuevo-negocio> --approval <archivo-aprobado-privado> --dry-run
node scripts/deploy/pilot-preflight.mjs --phase catalog --config <manifiesto-pilot-privado> --approval <archivo-aprobado-privado>
node scripts/import-pilot-catalog.mjs --target pilot --project-ref <nuevo-ref> --business-id <nuevo-negocio> --approval <archivo-aprobado-privado> --config <manifiesto-pilot-privado> --apply
node scripts/e2e-staging/build-rider-pilot.mjs --target pilot --project-ref <nuevo-ref> --version-code 4 --version-name 0.1.3-canonical
node scripts/e2e-staging/build-rider-pilot.mjs --target pilot --project-ref <nuevo-ref> --version-code 4 --version-name 0.1.3-canonical --android-test
node scripts/deploy/pilot-preflight.mjs --phase deploy --config <manifiesto-pilot-privado> --approval <archivo-aprobado-privado>
node scripts/deploy/prepare-commercial-pilot.mjs --config <manifiesto-pilot-privado> --approval <archivo-aprobado-privado> --commit <SHA-release-exacto>
node scripts/deploy/smoke-commercial-pilot.mjs --origin https://la-taba-commercial-pilot.pages.dev/ --project-ref <nuevo-ref> --business-id <nuevo-negocio> --approved-skus-file <archivo-aprobado-privado>
node scripts/deploy/check-moto-g15.mjs
node scripts/deploy/run-commercial-pilot-e2e.mjs --config <manifiesto-pilot-privado> --approval <archivo-aprobado-privado>
node scripts/deploy/drill-commercial-pilot-rollback.mjs --phase preflight --config <manifiesto-pilot-privado> --previous-id <deployment-previo> --candidate-id <deployment-candidate> --out <receipt-privado>
node scripts/deploy/drill-commercial-pilot-rollback.mjs --phase rollback --config <manifiesto-pilot-privado> --receipt <receipt-privado>
node scripts/deploy/drill-commercial-pilot-rollback.mjs --phase restore --config <manifiesto-pilot-privado> --receipt <receipt-privado>
```

El deploy Pages entre `prepare` y `smoke` debe ser una Direct Upload al proyecto
`la-taba-commercial-pilot`, rama productiva `pilot`, con Cloudflare token
privado. Registrar la respuesta de Cloudflare con el ID exacto; **no** usar un
deploy hook o el proyecto `taba2-staging`. Antes del rollback deben existir
dos deployments productivos exitosos y conservarse sus metadata y APK.
En la API de Cloudflare, `environment=production` significa el alias principal
**del proyecto Pages PILOTO**; el script fija el nombre del proyecto dedicado
y nunca llama al proyecto de La Taba Producción.

## Estados antes de la respuesta

- `CATALOG_APPROVED=NO`, `PILOT_PREFLIGHT=BLOCKED_AS_DESIGNED`.
- `PILOT_BACKEND_CREATED=NO`, `PILOT_DEPLOYED=NO`, `RIDER_V4_BUILT=NO`.
- La firma PKCS#12 sí fue restaurada desde OneDrive cloud-only y firmó con el
  mismo certificado. La contraseña sigue sólo en Credential Manager local;
  no se encontró vault externo autenticado. La recuperación tras pérdida total
  de la PC conserva este riesgo y no se resuelve poniendo el password junto al
  keystore en OneDrive en texto plano.
- `ADB_DEVICE_PASS=NO`: el servidor ADB funciona, pero el Moto G15 no figura
  actualmente. `node scripts/deploy/check-moto-g15.mjs` será el único comando
  de certificación de conectividad cuando vuelva, sin instalar ni borrar nada.

Fuentes de contrato consultadas: [Supabase Auth y RLS](https://supabase.com/docs/guides/auth/users),
[Cloudflare Pages rollback](https://developers.cloudflare.com/pages/configuration/rollbacks/),
[Cloudflare API rollback](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/rollback/).
