# Go-live · TABA2 producción

**Ninguna de estas etapas se ejecutó.** Cada una dice: qué comando, qué se espera,
cuándo parar, y cómo volver atrás.

Regla general: **si la condición esperada no se cumple exactamente, se para.** No
se sigue «a ver si se arregla sola en la etapa siguiente».

Los datos que faltan y quién puede darlos: `EXTERNAL-GATES.md`.

---

## 1 · Preflight

```bash
cd <worktree web>
npm run production:verify
```

| | |
|---|---|
| **Espera** | `7 verde · 0 falla · 0 omitido`, salida 0 |
| **STOP** | cualquier falla, o cualquier paso `OMITIDO` — un omitido no es un verde |
| **Rollback** | n/a, no cambió nada |

---

## 2 · Firma de producción · GATE EXTERNO

Requiere: alias, contraseña y la decisión sobre Play App Signing
(`EXTERNAL-GATES.md` §3).

```bash
keytool -genkeypair -v -keystore taba2-rider-upload.jks \
  -alias taba2-rider-upload -keyalg RSA -keysize 4096 -validity 10950 \
  -storetype PKCS12 -dname "CN=La Taba, O=La Taba, L=Neuquen, C=AR"
keytool -list -v -keystore taba2-rider-upload.jks -alias taba2-rider-upload
# cargar los 6 secretos en el entorno protegido rider-production-signing
```

| | |
|---|---|
| **Espera** | la huella impresa por `keytool` coincide con la variable `TABA_ANDROID_CERT_SHA256` |
| **STOP** | si no hay dos respaldos en lugares distintos. Una sola copia no es un respaldo. |
| **Rollback** | con Play App Signing, subir una clave de subida nueva. Sin él, no hay. |

---

## 3 · Dominio y auth · GATE EXTERNO

Requiere: el hostname (`EXTERNAL-GATES.md` §1).

```bash
curl -X PATCH https://api.supabase.com/v1/projects/wwcpogltfgzgkrlilbcd/config/auth \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"site_url":"https://<host>","uri_allow_list":"https://<host>,https://<host>/**"}'
sleep 30
node -e "fetch('https://api.supabase.com/v1/projects/wwcpogltfgzgkrlilbcd/config/auth',{headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN}}).then(r=>r.json()).then(j=>console.log(j.site_url,'|',j.uri_allow_list))"
```

| | |
|---|---|
| **Espera** | la sonda devuelve el host real; ni `localhost` ni el de staging |
| **STOP** | si la allow-list quedó con `*` suelto o con un host que no es el productivo |
| **Rollback** | restaurar desde `security/AUTH-CONFIG-BEFORE.json` |

---

## 4 · Mercado Pago · GATE EXTERNO

Requiere: credenciales productivas (`EXTERNAL-GATES.md` §4).

```bash
supabase secrets set --project-ref wwcpogltfgzgkrlilbcd --env-file <fuera del repo>
for f in mercadopago-payment-worker mercadopago-webhook \
         mercadopago-create-checkout-session mercadopago-create-preference \
         mercadopago-checkout-status mercadopago-refund \
         mercadopago-cancel-payment fiscal-artifact-access; do
  supabase functions deploy $f --project-ref wwcpogltfgzgkrlilbcd
done
supabase secrets list --project-ref wwcpogltfgzgkrlilbcd
```

| | |
|---|---|
| **Espera** | 8 funciones desplegadas; `MERCADOPAGO_ENVIRONMENT=test`; `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` **ausente** |
| **STOP** | si el review status aparece acá. El cobro real es la etapa 12, no ésta. |
| **Rollback** | `supabase secrets unset MERCADOPAGO_PRODUCTION_REVIEW_STATUS` |

---

## 5 · PITR · DECISIÓN DE GASTO

USD 100/mes por 7 días de ventana (`EXTERNAL-GATES.md` §5).

```bash
node -e "fetch('https://api.supabase.com/v1/projects/wwcpogltfgzgkrlilbcd/database/backups',{headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN}}).then(r=>r.json()).then(j=>console.log('pitr',j.pitr_enabled,'| walg',j.walg_enabled,'| backups',j.backups.length))"
```

| | |
|---|---|
| **Espera** | `pitr true` antes del primer pedido real |
| **STOP** | si se decide no contratarlo, dejarlo **escrito**: el punto de recuperación pasa a ser el respaldo diario, hasta 24 h de pedidos |
| **Rollback** | quitar el addon; se vuelve al respaldo diario |

---

## 6 · Reloj externo

```bash
npx wrangler deploy --config services/scheduler-watchdog/wrangler.toml --env production
npx wrangler secret put SUPABASE_ANON_KEY --config services/scheduler-watchdog/wrangler.toml --env production
# y en GitHub: variable SUPABASE_URL + secreto SUPABASE_ANON_KEY del proyecto PRODUCTIVO
```

| | |
|---|---|
| **Espera** | el Worker de producción apunta a `wwcpogltfgzgkrlilbcd`; el de staging sigue en el suyo |
| **STOP** | si los dos Workers comparten nombre — uno pisa al otro y queda un solo reloj |
| **Rollback** | `npx wrangler delete --env production` |

---

## 7 · Catálogo, negocio y equipo

```bash
npm run catalog:validate && npm run catalog:release:validate
npm run catalog:commercial:import          # con el CSV que confirmó el dueño
node scripts/set-pickup-point.mjs <lat> <lng> --origen=business_verified --confirmado-por-humano
```
Y las cuentas del equipo, por admin (nunca desde la app):
```sql
insert into public.business_members (business_id, user_id, role, is_active)
values ('00000000-0000-4000-8000-000000000001', '<user_id>', 'owner', true);
```

| | |
|---|---|
| **Espera** | catálogo con precios confirmados; pin **verificado a mano**; horarios y zona reales |
| **STOP** | si algún precio quedó pendiente, o si el pin no se miró en un mapa |
| **Rollback** | despublicar productos; el pin anterior lo imprime el propio script |

---

## 8 · Build final

```bash
# web
npm run vendor:build && node scripts/create-release-folder.mjs
# inyectar el runtime-config productivo en dist_release/ — nunca se commitea
TABA_RUNTIME_CONFIG_PATH=<fuera del repo> npm run config:check
node scripts/preflight-staging-package.mjs dist_release <config vivo>
node scripts/scan-production-artifacts.mjs dist_release dist-desktop \
  --business-id 00000000-0000-4000-8000-000000000001 \
  --expect-host wwcpogltfgzgkrlilbcd.supabase.co

# rider, desde el workflow protegido y una rama release/*
#   .github/workflows/signed-production-candidate.yml
```

| | |
|---|---|
| **Espera** | `artifact-scan OK`; el AAB firmado con la huella esperada; `distributable: true` |
| **STOP** | `distributable: false` con cualquier bloqueo. El manifiesto los enumera. |
| **Rollback** | no publicar. Nada salió todavía. |

---

## 9 · Verificación final

```bash
npm run production:verify
npx playwright test
node scripts/production-security-smoke.mjs --ref wwcpogltfgzgkrlilbcd --key-file <publishable>
```

| | |
|---|---|
| **Espera** | verify 7/7 · e2e 404/404 salida **0** · smoke `TODO CERRADO` |
| **STOP** | «404 verdes pero salida 1» no es verde |
| **Rollback** | n/a |

---

## 10 · Cutover de DNS

Ver `DNS-CUTOVER.md`. **El último cambio visible.**

| | |
|---|---|
| **Espera** | `dig` resuelve al destino nuevo; TLS válido; el hash del runtime-config coincide; cero errores de CORS en consola |
| **STOP** | cualquier error de CORS o de auth en el navegador |
| **Rollback** | volver el registro. Con TTL 300 previo, cinco minutos. |

---

## 11 · Smoke de producción

```bash
node scripts/production-health-check.mjs --ref wwcpogltfgzgkrlilbcd
```
Y a mano: abrir el sitio, ver catálogo real, entrar al Panel, abrir el Rider.

| | |
|---|---|
| **Espera** | `SANO`; el sitio carga con catálogo real; el Panel entra; el Rider autentica |
| **STOP** | cualquier pantalla vacía o error de sesión |
| **Rollback** | re-promover el despliegue anterior en Pages |

---

## 12 · Primer pedido real, controlado

**Con la persiana todavía cerrada**, un pedido creado por el Panel y seguido de
punta a punta: asignación, aceptación del Rider, entrega, cierre.

| | |
|---|---|
| **Espera** | el pedido recorre todos los estados; el Rider lo ve; el seguimiento público funciona |
| **STOP** | cualquier estado que quede colgado más de unos minutos |
| **Rollback** | cancelar el pedido desde el Panel |

---

## 13 · Primer cobro real · REQUIERE AUTORIZACIÓN EXPLÍCITA

**No se hace sin que Marco lo autorice en el momento.**

```bash
supabase secrets set MERCADOPAGO_ENVIRONMENT=production --project-ref wwcpogltfgzgkrlilbcd
supabase secrets set MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved --project-ref wwcpogltfgzgkrlilbcd
```
Importe mínimo, identidad controlada, pedido controlado, webhook observado en los
logs, estado final verificado en `payment_attempts` y `orders`, y devolución si
el protocolo la pide.

| | |
|---|---|
| **Espera** | el webhook llega firmado, el outbox lo procesa, el pedido queda pago |
| **STOP** | si el webhook no llega en dos minutos, o llega con firma inválida |
| **Rollback** | `supabase secrets unset MERCADOPAGO_PRODUCTION_REVIEW_STATUS` — una variable, sin desplegar |

---

## 14 · Abrir la persiana

```sql
update public.businesses
   set ordering_verified = true, ordering_enabled = true
 where id = '00000000-0000-4000-8000-000000000001';
```

| | |
|---|---|
| **Espera** | entran pedidos de clientes reales |
| **STOP** | no llegar acá sin las etapas 1–13 verdes |
| **Rollback** | `ordering_enabled = false`. Corta la entrada sin tocar lo que está en curso. |

---

## Monitoreo

**A los 15 minutos**

- [ ] `production-health-check` → `SANO`
- [ ] `curl -s https://<host>/runtime-config.js | sha256sum` → el hash preservado
- [ ] el sitio carga con catálogo real
- [ ] `auth.users` crece con las visitas
- [ ] el Panel ve la bandeja
- [ ] `scheduler_heartbeat` con antigüedad < 600 s
- [ ] 0 alertas `critical` sin resolver
- [ ] un pedido de prueba de punta a punta

**A las 24 horas**

- [ ] `operational_sweep_runs` con ~1.440 filas del día, ninguna `failed`
- [ ] los 4 cron `taba-*` activos, último estado `succeeded`
- [ ] `payment_outbox` sin filas atascadas
- [ ] ningún pedido colgado más de una hora
- [ ] el reloj de GitHub corrió ~144 veces sin mandar correo
- [ ] PITR con al menos un punto de recuperación

---

## Rollback

Por componente, en `RUNBOOK-ROLLBACK.md`. Los dos que importan:

| | |
|---|---|
| parar la entrada | `ordering_enabled = false` — un `update`, sin propagación |
| apagar el cobro real | quitar `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` — una variable, sin desplegar |
