# Gates externos · lo que falta y quién puede cerrarlo

Todo lo automatizable está cerrado. Lo que queda necesita un dato o una decisión
que no se puede inventar sin mentir. Este documento dice, para cada uno: qué
falta exactamente, por qué, qué bloquea, el formato esperado, y el comando.

**Cuatro decisiones de Marco. Nada más.**

| # | Gate | Qué necesito de vos |
|---|---|---|
| 1 | Dominio productivo | el hostname |
| 2 | DNS | dónde se administra ese dominio |
| 3 | Firma de Android | alias + contraseña + decisión de Play App Signing |
| 4 | Mercado Pago producción | credenciales productivas + aprobación para cobrar |

Aparte, una decisión de gasto: **PITR, USD 100/mes** (§5).

---

## 1 · Dominio productivo — GATE EXTERNO

### Qué falta
El hostname. Uno solo.

### Por qué no lo puedo deducir
Busqué en todo el árbol: no hay `CNAME`, ni `_redirects`, ni `_headers`, ni
`wrangler.toml` del sitio, ni `netlify.toml`, ni `vercel.json`. Los únicos hosts
desplegados que aparecen son:

| host | qué es |
|---|---|
| `taba2-staging.pages.dev` (24 menciones) | **staging** |
| `bitflowapp.github.io` (8) | vista previa vieja, registrada como rota |
| `PROJECT.supabase.co`, `PROJECT_REF.supabase.co` | plantillas |

Ninguno es producción. Inventar uno sería escribir una mentira en `site_url`.

### Qué bloquea
- `site_url` de GoTrue, hoy `http://localhost:3000`
- `uri_allow_list`, hoy vacía
- el secreto `TABA_CHECKOUT_BASE_URL` de Mercado Pago
- el secreto `TABA_ALLOWED_ORIGINS` (CORS de las Edge Functions)
- el cutover de DNS entero

### Lo importante: hoy falla cerrado, no falla mal
Con la allow-list vacía, GoTrue rechaza cualquier `redirect_to` que no sea el
`site_url`. No hay redirección abierta. Lo único que apunta a `localhost` son los
enlaces de correo, y hoy no son alcanzables: no hay cuentas y las del equipo se
crean por admin.

### Formato esperado
`https://<host>` — sin barra final, sin puerto, sin `www` si el canónico es el
ápice. Por ejemplo `https://lataba.com.ar` o `https://pedidos.lataba.com.ar`.

### Comando, una vez decidido
```bash
curl -X PATCH https://api.supabase.com/v1/projects/wwcpogltfgzgkrlilbcd/config/auth \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"site_url":"https://<host>","uri_allow_list":"https://<host>,https://<host>/**"}'
```
Verificar con una sonda, **no** con la respuesta del PATCH: GoTrue contesta antes
de recargar, y la propagación tarda de 10 a 30 s.

### Recomendación
Un subdominio dedicado al pedido (`pedidos.…`) separa el sitio comercial del
operativo y permite mover uno sin tocar el otro. Si el dominio ya está en
Cloudflare, Pages lo resuelve sin tocar registros a mano.

---

## 2 · DNS — GATE EXTERNO

### Qué falta
Dónde se administra el DNS del dominio del §1.

### Qué pude deducir, con evidencia
El frontend de staging vive en **Cloudflare Pages** (`taba2-staging.pages.dev`) y
el reloj externo es un **Cloudflare Worker**. Así que la cuenta de Cloudflare
existe y es la plataforma natural del sitio.

Lo que **no** puedo deducir es dónde está registrado el dominio: en esta máquina
no hay `wrangler` instalado, ni `~/.wrangler`, ni token de Cloudflare. Si el
dominio se delega a Cloudflare, el DNS es Cloudflare y el cutover es un registro.
Si se queda en el registrador, hay que crear los registros allá.

### Plan de cutover
Ver `DNS-CUTOVER.md`. Resumen: el DNS es **el último cambio visible**, después de
que auth, pagos y firma estén cerrados.

---

## 3 · Firma de Android — GATE EXTERNO

### Estado medido
```
Propietario : C=US, O=Android, CN=Android Debug
Emisor      : C=US, O=Android, CN=Android Debug
SHA256      : 3C:57:56:3D:1D:8E:8D:0A:7F:D0:72:C9:90:01:2B:D2:93:42:03:66:36:4F:2C:97:54:8E:14:6B:C1:AC:7F:81
```
Idéntica a `~/.android/debug.keystore` de esta máquina. El AAB del directorio
está firmado con la clave de **depuración**; `RELEASE.json` lo declara con
`distributable: false` y el motivo al lado.

No generé una clave. Una clave de subida creada al pasar, sin custodia, es peor
que no tenerla: si se pierde, **no hay forma de volver a publicar esa app** salvo
que Play App Signing esté activo.

### Qué necesito de vos — tres cosas
1. **Alias** de la clave. Recomendado: `taba2-rider-upload`.
2. **Contraseña** del keystore y de la clave. Pueden ser la misma; ≥20 caracteres,
   generada por un gestor, **nunca tipeada a mano**.
3. **Decisión sobre Play App Signing.** Es la que más importa: con Play App
   Signing, Google guarda la clave de firma y la tuya es sólo de *subida*;
   perderla es recuperable. Sin él, perder la clave es perder la app.
   **Recomendación: activarlo.**

### Generación — cuando decidas
```bash
keytool -genkeypair -v \
  -keystore taba2-rider-upload.jks \
  -alias taba2-rider-upload \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -storetype PKCS12 \
  -dname "CN=La Taba, O=La Taba, L=Neuquen, C=AR"
```
`-keysize 4096` y 30 años porque Play exige una validez que cubra 2033 y una
clave de subida no se rota sin trámite.

### Dónde vive
**Nunca en el repositorio.** `.gitignore` ya bloquea `*.jks`, `*.keystore` y
`key.properties`, y no hay ninguno rastreado.

| copia | dónde |
|---|---|
| operativa | secreto de GitHub, base64, en el entorno protegido `rider-production-signing` |
| respaldo 1 | gestor de contraseñas del dueño, adjunto + contraseña |
| respaldo 2 | medio físico cifrado, fuera de la casa |

Dos respaldos en lugares distintos, porque una sola copia no es un respaldo.

### Secretos que el workflow espera
```
TABA_ANDROID_KEYSTORE_BASE64      base64 del .jks       secreto
TABA_ANDROID_KEYSTORE_PASSWORD                          secreto
TABA_ANDROID_KEY_ALIAS                                  secreto
TABA_ANDROID_KEY_PASSWORD                               secreto
TABA_ANDROID_CERT_SHA256          huella esperada       variable (pública)
TABA2_CONTROLLED_PRODUCTION_PILOT_APPROVAL              secreto, valor fijo
```

### Verificación, sin revelar nada
```bash
keytool -list -v -keystore taba2-rider-upload.jks -alias taba2-rider-upload   # huella
# y después de construir, que el artefacto lleve ESA huella:
keytool -printcert -jarfile app-production-release.aab
```
El workflow ya compara la huella del artefacto contra `TABA_ANDROID_CERT_SHA256` y
falla si no coincide.

### Recuperación
Con Play App Signing: subir una clave de subida nueva desde Play Console. Sin él:
no hay recuperación. Es exactamente por eso que la decisión 3 es la que importa.

### Lo que YA está cerrado
- release de production sin keystore → **rechaza**
- con el escape hatch `TABA_ALLOW_UNSIGNED_RELEASE=1` → **sigue rechazando**
- sin fallback a la clave de depuración en ningún camino
- el manifiesto nombra al firmante y bloquea `distributable` si es la de depuración

---

## 4 · Mercado Pago producción — GATE EXTERNO

### Estado medido
0 Edge Functions desplegadas, 0 secretos cargados. El cobro real falla cerrado en
dos capas independientes:

```js
// providerEnvironment(), payment-runtime.ts:192
if (value === 'production' && optionalEnv('MERCADOPAGO_PRODUCTION_REVIEW_STATUS') !== 'approved')
  throw new Error('Production Mercado Pago review is not approved');

// requireRealPaymentSmokeAuthorization(), :203
if (environment === 'production'
    && optionalEnv('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION')
       !== 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE')
  throw new Error('A real Mercado Pago payment smoke has not been explicitly authorized');
```

### El contrato, ya verificado
| | |
|---|---|
| firma del webhook | HMAC-SHA256 sobre el manifiesto oficial (`x-signature` + `x-request-id` + `data.id` de la query) |
| firma inválida o ausente | **401**, y el recibo se audita pero **no** entra al procesador durable |
| repetición | recibo deduplicado por `webhookEventId`, con bandera `duplicate` |
| límite de tasa | 240 por 60 s |
| quién decide que se pagó | el **outbox durable**, leyendo la API del proveedor. Nunca el cliente. |
| crear un pedido pago | `finalize_paid_checkout_session` está concedida **sólo a `service_role`** |
| insertar en `orders` | ningún rol de cliente tiene el privilegio — medido: HTTP 400 |
| CORS | lista blanca desde `TABA_ALLOWED_ORIGINS`; sin origen conocido no se emiten cabeceras |

### Qué necesito de vos
Las credenciales productivas de la cuenta de Mercado Pago, cargadas **por vos**
en un archivo fuera del repositorio, y la aprobación para cobrar.

### Secretos, por nombre
```
MERCADOPAGO_ACCESS_TOKEN          productivo, distinto del de pruebas
MERCADOPAGO_WEBHOOK_SECRET        productivo
MERCADOPAGO_ENVIRONMENT           'test' primero; 'production' recién al final
PAYMENT_LOG_HASH_SALT             nuevo, no reutilizar el de staging
PAYMENT_WORKER_SECRET             nuevo
TABA_ALLOWED_ORIGINS              depende del §1
TABA_CHECKOUT_BASE_URL            depende del §1
```
Los `SUPABASE_*` los inyecta la plataforma.

**Falta a propósito y debe seguir faltando hasta el día del cobro:**
`MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`.

### Comandos
```bash
supabase secrets set --project-ref wwcpogltfgzgkrlilbcd --env-file <archivo fuera del repo>
for f in mercadopago-payment-worker mercadopago-webhook \
         mercadopago-create-checkout-session mercadopago-create-preference \
         mercadopago-checkout-status mercadopago-refund \
         mercadopago-cancel-payment fiscal-artifact-access; do
  supabase functions deploy $f --project-ref wwcpogltfgzgkrlilbcd
done
# lectura de control que NO imprime valores:
supabase secrets list --project-ref wwcpogltfgzgkrlilbcd
```

### Rollback
```bash
supabase secrets unset MERCADOPAGO_PRODUCTION_REVIEW_STATUS --project-ref wwcpogltfgzgkrlilbcd
```
Una variable, sin desplegar nada, y el cobro real se apaga.

---

## 5 · PITR — DECISIÓN DE GASTO

### Estado medido
```
pitr_enabled : false
walg_enabled : true
backups      : 2 físicos, COMPLETED (2026-08-16 06:35 y 06:43)
plan de la organización : pro
addons contratados      : compute_instance ci_micro (~USD 10/mes)
```

### Qué falta y cuánto cuesta
PITR es un addon del proyecto, disponible en el plan actual pero **no
contratado**:

| variante | ventana | precio |
|---|---|---|
| `pitr_7` | 7 días | **USD 100/mes** |
| `pitr_14` | 14 días | USD 200/mes |
| `pitr_28` | 28 días | USD 400/mes |

No lo activé: implica gasto y eso no es una decisión técnica.

### Qué protege, y qué riesgo queda sin él
Con PITR se vuelve a **cualquier segundo** de la ventana. Sin PITR, el punto de
recuperación es el respaldo físico diario: en el peor caso se pierde **hasta un
día de pedidos**, y no hay forma de recortar esa pérdida.

Hoy la exposición es **cero**: no hay datos humanos y la persiana está cerrada.
La ventana se abre exactamente cuando entre el primer pedido real.

### Alternativa temporal
Un volcado lógico diario a un destino propio recorta el daño pero no lo elimina:
sigue habiendo hasta 24 h de hueco y agrega infraestructura que hay que vigilar.
Para un comercio que factura por día, USD 100/mes es más barato que un día de
pedidos perdidos. **Recomendación: contratar `pitr_7` antes del primer pedido.**

No afirmar que hay DR sólo porque existen dos respaldos físicos del día en que se
creó el proyecto.
