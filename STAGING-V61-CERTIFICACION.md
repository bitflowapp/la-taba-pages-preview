# Cliente v61 en staging: publicación y certificación

Candidato congelado **`1d26c4b`** publicado en `https://taba2-staging.pages.dev`
y certificado contra el artefacto realmente servido, en modo producción y con
la base viva detrás.

## Entrega

| | |
|---|---|
| **deployment** | `8241b56f-532c-41ba-8482-ef96a3299549` (Production, rama `staging`) |
| **HEAD servido** | `1d26c4b` — Cloudflare registró el commit exacto |
| **anterior / rollback** | `c184ffb6-325e-44d1-8c2e-3ae245b09d50` (`399d0cc`, CACHE v60) |
| **paquete** | 349 archivos · 17 subidos, 332 ya conocidos por hash |
| **CACHE_NAME observado** | `la-taba-runtime-v61-cliente-comercial-mapa-permanente` |
| **versiones observadas** | `app.js?v=41` · CSS `?v=49` · `startup-recovery.js?v=2` · `pwa-update.js?v=3` |
| **runtime-config.js** | **preservado byte a byte**: 684 B, sha256 `57d8a007…`, idéntico antes y después |
| **lock** | `taba2-staging-mutation.lock` tomado y cerrado; respaldo en `artifacts/ci/staging-v61/preserva/` |

Staging es **Cloudflare Pages `taba2-staging`**, proyecto sin git provider: se
publica por subida directa. El GitHub Pages del repositorio
(`bitflowapp.github.io/la-taba-pages-preview`) sirve un artefacto de julio
(`v39`) con la configuración vacía y **no es** staging; no se tocó.

## Antes de mutar

1. HEAD exacto `1d26c4b`, árbol limpio. ✅
2. Lock libre (`STATUS=CERRADO_CERTIFICADO`) antes de tomarlo. ✅
3. Deployment actual identificado y rollback anotado. ✅
4. `runtime-config.js` vivo descargado y hasheado **antes** de construir. ✅

### El preflight se plantó, que es para lo que existe

`scripts/preflight-staging-package.mjs` comprueba cuatro cosas sobre el paquete
antes de que salga: que no se cuelen rutas que el sitio no publica, que
`runtime-config.js` sea el vivo, que todo lo que el worker promete precachear
exista, y que no haya mezcla de versiones.

En la primera pasada **detuvo la publicación**:

```
✗ runtime-config.js NO es el vivo (paquete b38d58f8… vs vivo 57d8a007…)
```

`create-release-folder.mjs` copia el `runtime-config.js` del repositorio, que es
la plantilla vacía que falla cerrada. Publicarla habría apagado staging. Se
sustituyó por los bytes vivos y recién entonces el preflight pasó.

## Lo realmente servido

`scripts/verify-staging-served.mjs` pide **una por una** las entradas del
precache al origen público y compara bytes contra el paquete:

```
entradas del precache comprobadas: 118
idénticas al paquete publicado: 118
sin 404 y sin mezcla de versiones
```

Importa porque `cache.addAll()` es todo o nada: un solo 404 deja al worker sin
instalar y el cliente se queda con el anterior.

## Certificación contra staging

`scripts/certify-staging-always-map.mjs`, sitio público, **sin `?demo=1`**,
4 anchos × 2 motores. No se creó ningún pedido ni se movió dinero.

### Gate principal — cliente nuevo, sin pedidos, toca «Seguir»

| | |
|---|---|
| mapa presente y visible | ✅ 1 mapa, lienzo pintado |
| **mapa realmente dibujado** | ✅ verificado por píxeles: desvío 36,8–46,6 sobre la región del lienzo |
| contexto del negocio | ✅ encuadre en Neuquén/Cipolletti + píldora «La Taba · …» |
| tarjeta idle | ✅ «Seguí tu pedido» |
| barra inferior | ✅ |
| rider inventado | ✅ 0 |
| destino inventado | ✅ 0 |
| ETA inventada | ✅ 0 |
| control de recentrar sin rider | ✅ 0 |

Captura: `artifacts/ci/staging-v61/certificacion/chromium/390/02-seguir-sin-pedido.png`

### Las ocho validaciones

| | | |
|---|---|---|
| 1 | Home → agregar → recargar → carrito persiste | ✅ 1 → 1, clave `la_taba_production_cart_v1` escrita, **en producción real** |
| 2 | Seguir idle → mapa | ✅ |
| 3 | preparing → mapa | ✅ |
| 4 | on_the_way sin GPS → mapa **sin rider falso** | ✅ mapa presente, 0 rider |
| 5 | delivered → mapa + resumen | ✅ |
| 6 | salida de Seguir por la barra | ✅ → catálogo |
| 7 | 320 / 360 / 390 / 432 | ✅ los cuatro |
| 8 | Chromium + mobile WebKit | ✅ los dos |

Y además: **0 errores de consola inesperados · 0 respuestas 4xx/5xx · 0 overflow
· 0 CTA tapado** (hit test real) · un solo lienzo `[1,1,1,1]` a lo largo de los
cuatro estados.

### Cliente recurrente, no sólo navegador fresco

Se planta la caché `la-taba-runtime-v60-…` **antes** de que el worker nuevo
instale —el orden real de un cliente que vuelve— y se entra a la aplicación:

```
cachés antes de entrar: ["la-taba-runtime-v60-seguimiento-sin-replay"]
después:                ["la-taba-runtime-v61-cliente-comercial-mapa-permanente"]
controlado por worker=true · js/app.js?v=41 · mapa visible en Seguir
```

En los dos motores. La primera pasada de esta prueba falló en WebKit y **era la
prueba, no el producto**: plantaba la caché vieja después de que `activate` ya
había corrido, y `activate` no vuelve a correr sin un worker nuevo.

### Backend

```
modo=production · repositorio=supabase · 12 productos verificados · 4 comprables
compuerta de catálogo cerrada=no
200 en: orders · businesses · products · auth/signup · auth/user
        rpc/get_public_business_contact · rpc/get_mercadopago_checkout_availability
        rpc/get_current_customer_profile
```

## Diferencias local vs staging

Dos, ninguna es una regresión, las dos hay que saberlas.

**1 · El pin del negocio no se dibuja — ni antes ni ahora.** La demo local lo
muestra; staging no. La causa no es el deploy: el cliente resuelve
`businessLocationVerified: false`, y el contrato de ubicación del propio
repositorio declara `human_verified=false` para Mendoza 827. El mapa se rehúsa
a plotear un punto sin verificar, que es exactamente lo que el gate pide tres
líneas más abajo («0 destino inventado»).

Comprobado que es estado del backend y no del artefacto: el deployment anterior
(`c184ffb6`, v60), contra la misma base, resuelve el mismo
`businessLocationVerified: false`. Lo que cambió es que **antes no había mapa**
—«Todavía no hay un pedido en curso», sin mapa— y **ahora lo hay**.

Para que aparezca el pin hay que verificar la ubicación **en el backend**. No se
tocó el cliente para forzarlo.

**2 · El mapa tarda ~3,4–3,8 s en pintar sus teselas.** Local las sirve desde el
disco y pinta casi instantáneo; staging las trae de `tiles.openfreemap.org`. La
superficie del mapa, la píldora, la tarjeta y la barra están desde el primer
frame; lo que llega a los ~3,7 s son las calles.

Esto costó un falso negativo: la primera pasada de la certificación midió a los
1,2 s, fotografió un rectángulo liso y lo reportó como «el mapa no aparece». Se
diagnosticó sin tocar código —tiles 200, WebGL activo, teselas pedidas
exactamente sobre −38,946/−68,053— y se corrigió **la medición**: ahora espera a
que dejen de llegar teselas y verifica por varianza de píxeles que el lienzo
tenga un mapa y no un rectángulo.

## Lo que no se tocó

Producción, backend, migraciones, Rider, auto-dispatch, ARCA, dinero real. Los
124,5 KB de tracking que bajan en el inicio siguen bajando: es la optimización
siguiente, después de certificar.

## Rollback

No hizo falta. Si hiciera falta:

```bash
npx wrangler pages deployment list --project-name taba2-staging
# volver a c184ffb6-325e-44d1-8c2e-3ae245b09d50 desde el panel de Cloudflare,
# o republicar el paquete anterior preservando runtime-config.js vivo.
```
