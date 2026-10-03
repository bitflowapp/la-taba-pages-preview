# Rollback · TABA2 producción

Un rollback por componente, porque los componentes fallan por separado y
revertirlos juntos apaga cosas que andaban.

**«Revertir el commit» no es un rollback de ninguno de los cinco.** El artefacto
publicado no es el árbol de fuentes: es un paquete con su propia identidad, y en
Android el sistema operativo prohíbe explícitamente volver al número anterior.

---

## 0 · Lo primero, siempre

```bash
# ¿la base está viva y es la que creemos?
node scripts/production-health-check.mjs --ref wwcpogltfgzgkrlilbcd
```

Si eso da `SANO`, el incidente no es de la base y el rollback es de una capa de
arriba. Si no, seguir por **§3 Base**.

---

## 1 · Web (Customer + Panel)

| | |
|---|---|
| Qué se publica | el contenido de `dist_release/`, más un `runtime-config.js` que se inyecta en el despliegue |
| Identidad | `CACHE_NAME` en `sw.js` — hoy `la-taba-runtime-v71-production-rc2` |
| Tiempo | minutos |

**Volver atrás:** re-promover el despliegue anterior en el panel de Cloudflare
Pages. No se reconstruye: se promueve el que ya estaba.

**Después, sin excepción**, porque es el error que deja el sitio sin arrancar:

```bash
curl -s https://<dominio>/runtime-config.js | sha256sum
```

Tiene que dar el hash del config productivo preservado, **no** el de la plantilla
del repositorio. La plantilla falla cerrado a propósito: publicarla apaga el
sitio en vez de dejarlo hablando con el backend equivocado.

**El service worker.** Un cliente que ya tiene la versión nueva cacheada no
vuelve solo al promover el despliegue anterior: `sw.js` es network-first con un
corte de 4 s y un disyuntor de 3 fallos / 10 s, así que al recuperar la red
adopta lo que sirve el origen. El caché viejo se borra en `activate` sólo cuando
el nuevo está completo. En la práctica: promover, esperar una recarga, y
verificar el hash. No hace falta tocar nada más.

---

## 2 · Rider (Android)

| | |
|---|---|
| Qué se publica | un AAB firmado con la clave de subida, desde el workflow protegido |
| Identidad | `applicationId` + `versionCode` |
| Tiempo | el de la revisión de la tienda |

**Android no deja bajar el `versionCode`, ni siquiera para volver al código
anterior.** Un rollback es *reconstruir el código viejo con un número nuevo*:

```bash
git checkout <commit-que-funcionaba>
# el versionCode sale de la historia; para fijarlo a mano:
#   TABA_VERSION_CODE=<mayor que el publicado>
# y actualizar android/version-ledger.properties DESPUÉS de publicar
```
Mismo workflow, misma clave, mismo canal. Cualquier otra cosa produce un
artefacto que los teléfonos ya actualizados no pueden instalar.

**Mientras tanto**, si el Rider está roto y hay entregas en curso: el Panel sigue
pudiendo asignar, y el rider puede operar por teléfono. El corte de la app no
corta la operación, corta la traza.

---

## 3 · Base (Supabase)

**Forward-only. No hay `down`.** Las 103 migraciones son historia aplicada; una
de ellas se corrige con la 104, nunca editándola.

```bash
node scripts/assert-production-supabase-target.mjs --ref wwcpogltfgzgkrlilbcd --category "db push"
node scripts/audit-remediation-migrations.mjs      # la historia tiene que seguir intacta
supabase db push --linked --dry-run
supabase db push --linked --yes
```

Si el problema es de **datos** y no de esquema: PITR. **Hoy no está encendido**
— es un ítem del checklist de promoción y cuesta plan. Sin PITR el único
respaldo es el WAL-G que Supabase gestiona, y no hay copia física listada.

---

## 4 · Auth

La configuración vive en el proyecto, no en el repositorio. El estado exacto de
partida está en `security/AUTH-CONFIG-BEFORE.json` y el aplicado en
`security/AUTH-CONFIG-AFTER.json`.

```bash
# restaurar un campo puntual
curl -X PATCH https://api.supabase.com/v1/projects/wwcpogltfgzgkrlilbcd/config/auth \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"<campo>": <valor anterior>}'
```

La propagación tarda entre 10 y 30 segundos: verificar con una sonda, no con la
respuesta del PATCH, que contesta antes de que GoTrue recargue.

---

## 5 · Pagos

**El más importante, y el único que no necesita desplegar nada.**

Quitar `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` de los secretos del proyecto.
`providerEnvironment()` vuelve a tirar si el entorno es `production`, y el cobro
real se apaga entero.

```bash
supabase secrets unset MERCADOPAGO_PRODUCTION_REVIEW_STATUS --project-ref wwcpogltfgzgkrlilbcd
```

Hoy ese secreto **no está cargado**, así que el cobro real ya está apagado.

---

## 6 · Pedidos — el interruptor general

```sql
update public.businesses
   set ordering_enabled = false
 where id = '00000000-0000-4000-8000-000000000001';
```

Deja de entrar trabajo nuevo sin tocar lo que está en curso ni tumbar la base.
Es el primer movimiento ante cualquier incidente operativo dudoso: parar la
entrada cuesta minutos de venta; seguir aceptando lo que no se puede cumplir
cuesta el pedido y el cliente.

Hoy está en `false`, junto con `ordering_verified`.

---

## Qué NO hacer

| | |
|---|---|
| `supabase db reset` contra producción | borra la base |
| editar una de las 103 migraciones | rompe el ledger y la próxima verificación de digest |
| bajar el `versionCode` | el artefacto no instala sobre lo publicado |
| publicar el `runtime-config.js` del repositorio | es la plantilla; apaga el sitio |
| `docker prune` para «limpiar» | hay 23 contenedores de otros trabajos en esta máquina |
