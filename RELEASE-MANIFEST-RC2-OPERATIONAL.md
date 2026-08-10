# TABA2 Pilot · RC2 operativa

**Rama:** `release/taba2-pilot-rc2-operational`
**Base:** `release/taba2-pilot-rc1` (`f4588f9`) — ancestro directo, sin divergencia
**Qué agrega:** que el sistema se vigile solo, y que se pueda ver si lo está haciendo.
**Qué NO agrega:** ni una función comercial.

---

## 1. Ancestry

`release/taba2-pilot-rc1` es ancestro de esta candidata: no hay un solo commit de
RC1 que falte acá. Los cinco commits que se suman son todos de resiliencia:

| commit | qué |
| --- | --- |
| `d1eb2e0` | el aviso de actualización deja de quedar huérfano (P1 de RC1) |
| `07a051a` | las alertas se evalúan solas + salud operativa |
| `51b17db` | «Cómo viene el sistema» en el Panel |
| `0bcfc32` | una tarea en su primera corrida no está detenida |
| `e7466b5` | quién vigila al vigilante |

No se tocó catálogo, tracking, el Panel de recuperación ni ningún contrato
existente: el diff contra RC1 son 20 archivos, y los únicos de producto son
`index.html` (un botón de descarte y las versiones), `js/pwa-update.js`,
los dos módulos del Panel, `styles/business.css` y `sw.js`.

## 2. Publicado en staging

| | |
| --- | --- |
| proyecto | Cloudflare Pages `taba2-staging`, rama `staging` |
| deployment | `0e01f5f1` |
| archivos | 351 subidos, **7 nuevos**, 344 ya presentes |
| verificación | **351/351** responden 200 con bytes idénticos y content-type correcto |
| `runtime-config.js` | **preservado byte a byte**: 684 B, sha256 `57d8a007…c8716` |

**Qué se preservó, y cómo se sabe:** Cloudflare reconoció **344 archivos como ya
presentes** —los identifica por hash— y sólo subió 7. Catálogo, imágenes,
seguimiento, el Panel de recuperación y el resto del producto están entre esos
344: no cambió un byte. Los 7 que sí cambiaron son `index.html`, `sw.js`,
`styles.css`, `styles/business.css`, `js/pwa-update.js` y los dos módulos del
Panel.

**Un solo bump, y porque correspondía:** cambió código precacheado
(`js/pwa-update.js`) y una hoja de estilo (`styles/business.css`), así que rotan
juntos la caché del worker (`v58` → `v59`), la cadena de hojas (`?v=47` → `?v=48`)
y el script del aviso (`?v=2` → `?v=3`). `js/app.js` sigue en `?v=40`: no cambió.

## 3. Certificado en la URL pública

**`https://taba2-staging.pages.dev`**, contra la base viva, con una cuenta de
operador **TEST creada y borrada** en el mismo acto (13/13):

* el Panel abre y el Centro de operación dibuja «Cómo viene el sistema»;
* cada valor de la pantalla coincide con lo que el servidor mide en ese momento
  —vigilancia, tareas del planificador, dinero cobrado sin pedido, configuración
  de cobros—, comparado contra la RPC en la misma corrida;
* **sin datos no es verde**: el módulo PUBLICADO, con la salud ausente, dibuja
  `sin-datos` en tono de atención y dice que todavía no puede decirlo;
* ni un secreto en la pantalla: cero cadenas con forma de credencial en el HTML;
* las dos alertas que ya existían siguen apareciendo, en castellano y sin el
  código interno;
* cero errores de consola y cero respuestas 4xx/5xx.

**Service worker en la URL pública (8/8):** instalación limpia deja una sola
caché, la de esta release, y el aviso no aparece porque no hay nada que
actualizar; y un perfil que arranca con la caché de la publicación anterior la
ve borrarse sola al activar, quedando 101 entradas precacheadas.

## 4. Backend

Ledger remoto **72/72**, sin ninguna migración local pendiente y sin maniobras
manuales: `supabase db push` responde `Remote database is up to date`.

Barridos autónomos después del deploy: **ocho corridas consecutivas**, una por
minuto, todas `ok`, cero críticas.

## 5. Gates

| Gate | Resultado |
| --- | --- |
| `npm run check` | verde |
| `npm test` | **1289/1289** |
| Playwright (Chromium + mobile WebKit) | **243/243** en 9,2 min |
| `npm run migrations:validate` | 72 en orden |
| `npm run secrets:scan` | limpio |
| Ensayos de resiliencia (PostgreSQL real) | **13 ensayos · 74 afirmaciones** |
| Salud en la URL pública | **13/13** |
| Service worker en la URL pública | **8/8** |
| Conjunto publicado | **351/351** bytes idénticos |

## 6. Rollback

* **Frontend:** volver a publicar el árbol de `f4588f9` conservando el
  `runtime-config.js` vivo, o restituir el deployment `aee2e619` desde el panel
  de Cloudflare Pages.
* **Backend:** las cuatro migraciones de resiliencia son aditivas y no tocan
  datos. `select cron.unschedule('taba-operational-alerts-sweep');`, restituir
  `refresh_operational_alerts` y `get_production_operation_center` desde
  `f4588f9`, quitar el trigger `orders_kick_scheduler_watchdog`, y borrar las
  funciones nuevas y `public.operational_sweep_runs`.
* **Worker:** `npx wrangler delete --name taba2-scheduler-watchdog`.
