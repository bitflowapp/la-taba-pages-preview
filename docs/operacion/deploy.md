# Cómo llega `main` a producción

Una sola ruta, reproducible y auditable. Para operar esto no hace falta conocer
ninguna conversación previa.

```
merge a main  →  CI obligatorio  →  (verde)  →  build  →  Cloudflare Pages  →  smoke en vivo
```

## Qué es producción

| | |
|---|---|
| URL pública | <https://la-taba.pages.dev> |
| Proveedor | Cloudflare Pages |
| Proyecto | **`la-taba`** |
| Rama del proyecto | **`main`** |
| Directorio publicado | `dist_release` (216–217 archivos) |
| Supabase | `wwcpogltfgzgkrlilbcd` (producción) |
| Negocio | `00000000-0000-4000-8000-000000000001` |

**`taba2-staging` es otro proyecto**, con otra base. Publicar el artefacto de
producción ahí —o al revés— cambia de entorno sin que nadie lo decida. Hay una
prueba que falla si el nombre del proyecto cambia.

**GitHub Pages no es producción.** El workflow `preview-pages.yml` publica una
previsualización y nada más.

## El problema que esto cerró

El 2026-08-24 `main` tenía el runtime **v85** y la web pública servía el **v84**.
El despliegue histórico era *Direct Upload* desde una máquina —`wrangler pages
deploy` a mano, cuatro comandos en orden— así que `main` y producción se
desacoplaban con sólo no ejecutarlos, y nada avisaba.

## El disparo

`.github/workflows/deploy-production.yml` se dispara por `workflow_run` del gate
obligatorio *Validate release candidate*, sobre `main`, **sólo si terminó en
verde**, y despliega **exactamente el SHA que ese gate aprobó**.

- **Nunca se despliega un SHA sin certificar.** El disparo manual
  (`workflow_dispatch`) consulta la API y se planta si ese SHA no tiene una
  corrida verde de *Validate release candidate*.
- **No se repite el gate caro.** El E2E son 28–33 minutos y ya corrió sobre esos
  mismos bytes. Repetirlo no agrega información.

### Producción no puede retroceder

El escenario a evitar: entra el merge A, entra el merge B, y el despliegue de A
termina después del de B — producción quedaría en A, vieja, sin que nadie lo
note. Dos defensas:

1. `concurrency: deploy-production` con `cancel-in-progress: true` — la corrida
   vieja se cancela.
2. El paso **«No retroceder»** compara el SHA que está por publicar contra la
   punta real de `origin/main`. Si ya no es la punta, sale sin desplegar y deja
   que gane la corrida del SHA nuevo.

## El build, paso por paso

`scripts/deploy/preparar-artefacto.mjs` corre la misma cadena que antes se hacía
a mano:

| # | qué | por qué importa |
|---|---|---|
| 1 | `npm run vendor:build` | el bundle del cliente de Supabase |
| 2 | `create-release-folder.mjs` | el árbol publicable, con la compuerta de derechos de las fotos |
| 3 | `build-production-runtime-config.mjs` | **deriva** el `runtime-config.js` productivo y falla cerrado si no queda *production ready* |
| 4 | `sellar-version.mjs` | escribe `version.json` con commit + runtime |
| 5 | `scan-production-artifacts.mjs` | el contrato: que no viaje una credencial de servidor ni una superficie de otro entorno |

El paso 3 **nunca** escribe el config a mano. Un archivo escrito a mano al
desplegar es exactamente por donde entró un ref de staging la última vez.

## Los secretos que hacen falta

| nombre | tipo | para qué |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | publicar en Pages |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | identificar la cuenta |
| `SUPABASE_PUBLISHABLE_KEY` | Secret (**opcional**) | la clave publicable |

Se cargan en **Settings → Secrets and variables → Actions → Secrets**.

`SUPABASE_PUBLISHABLE_KEY` es opcional: si no está, el build la lee del
`runtime-config.js` del sitio ya publicado, que es de donde cualquier navegador
la saca. Es pública por diseño y la autoridad real es RLS. Si el valor fuera
inválido, el paso 3 no escribe nada y el build se planta: el respaldo no afloja
la compuerta, sólo evita una credencial redundante.

### El token, con el mínimo privilegio

Crear en Cloudflare → *My Profile* → *API Tokens* → *Create Token* → *Custom
token*:

| permiso | nivel |
|---|---|
| **Account · Cloudflare Pages · Edit** | el único |

Y acotar *Account Resources* a la cuenta que tiene el proyecto `la-taba`.

**No hace falta** —y no hay que darle— DNS, Workers, facturación,
administración de cuenta, ni Zone. **No usar un Global API Key**: abre la cuenta
entera y no se puede acotar.

El `ACCOUNT_ID` sale del panel de Cloudflare, en la barra lateral de la cuenta o
en la URL del dashboard.

Si falta alguno, el paso falla nombrándolo:

```
::error::DEPLOY CONFIGURATION MISSING: CLOUDFLARE_API_TOKEN
```

## Verificar sin adivinar

Cada despliegue publica `version.json`, un archivo estático y público:

```json
{
  "commit": "956fa74f1229d0157ad6ff85fb811839a6beceea",
  "runtime": "la-taba-runtime-v85-pildora-del-mapa",
  "builtAt": "2026-08-24T03:58:44.221Z"
}
```

No lleva secretos: commit, nombre de caché y fecha. Lo único que agrega es poder
responder «¿qué hay publicado?» sin bajar `sw.js` y buscar una constante a ojo.

```
node scripts/deploy/verificar-publicado.mjs
node scripts/deploy/verificar-publicado.mjs --esperar-commit <sha>
```

Comprueba: HTTP, que el shell llegue, el commit esperado, que el Supabase sea el
de **producción**, que **no** sea staging, el negocio canónico, que la clave sea
publicable, que el `runtime-config` **no** sea la plantilla vacía, que el service
worker coincida con el sello, y que el catálogo conteste.

> **Ojo con Cloudflare Pages**: contesta el shell de la aplicación a cualquier
> ruta que no existe. Un archivo ausente llega como **HTTP 200 con HTML**, no
> como 404. El verificador lo distingue.

### El deployment de Cloudflare

```
npx wrangler@4 pages deployment list --project-name la-taba
```

## Desplegar a mano

Sólo si hace falta saltear el disparo automático:

Actions → *Deploy production* → *Run workflow* → el SHA. Se planta si ese SHA no
tiene CI verde o si ya no es la punta de `main`.

Enteramente a mano, como se hacía antes:

```
node scripts/deploy/preparar-artefacto.mjs --commit "$(git rev-parse HEAD)"
npx wrangler@4 pages deploy dist_release --project-name la-taba --branch main
node scripts/deploy/verificar-publicado.mjs --esperar-commit "$(git rev-parse HEAD)"
```

## Volver atrás

Ver [`rollback.md`](./rollback.md).
