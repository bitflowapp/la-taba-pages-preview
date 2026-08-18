# La Taba, instalable — handoff

Rama `feature/taba2-pwa-installable`, en su propio worktree, desde
`feature/taba2-production-auth-go-live @ 34c6ee3` (que quedó **intacta**).
Sin push, sin deploy, 0 migraciones, 0 archivos bajo `catalog/`, `data/` o
`supabase/`. El lock (`_claude-locks/taba2-pwa-installable.txt`) y las capturas
(`artifacts/taba2-pwa-install/`) viven al lado de los worktrees, fuera del
repositorio. Las rutas absolutas no entran en este archivo y está bien que así
sea: `check-release-hygiene` las rechaza porque esto se publica.

## Qué había antes

No se partió de cero, y eso cambió el trabajo: **ya existían el manifest, el
service worker, el registro del worker y un módulo de detección**
(`js/core/pwa-install.js`) con sus tests. Lo que faltaba no era la
infraestructura sino que la instalación FUNCIONARA:

| Pieza | Estado que se encontró |
| --- | --- |
| `manifest.webmanifest` | `name` "TABA2 · Tienda de bebidas", `short_name` "TABA2", fondo crema `#fff8f1`, **un solo icono SVG** repetido como `any` y como `maskable` |
| `apple-touch-icon` | apuntaba a **`assets/icon.svg`**. iOS no rasteriza SVG ahí: cuando no encuentra un mapa de bits guarda una **captura de la página** como icono |
| La invitación | **nunca aparecía**. Los dos avisos existían en el shell y colgaban de `taba:request-install` / `taba:request-ios-install-guide`, dos eventos que **nadie despacha en todo el repositorio** |
| Detección | correcta pero corta: `isIOS`/`isStandalone` sí, `isAndroid`/`isDesktop` no |
| iOS | la guía se ofrecía **sólo a Safari**; Chrome/Edge/Firefox para iOS —que también pueden agregar al inicio— quedaban afuera, y el WebView de Instagram —que **no** puede— quedaba adentro |
| Entrada manual | no existía |
| Service worker | sano y network-first, y **no cachea datos vivos**: sólo GET del mismo origen, y Supabase (pedidos, identidad, seguimiento) es otro origen |

O sea: había un esqueleto de PWA que **no era instalable con la marca correcta y
no le ofrecía instalarse a nadie**.

## Archivos

**Nuevos**

- `assets/brand/taba-app-icon{.svg,-192.png,-512.png,-maskable-192.png,-maskable-512.png,-apple-180.png}`
- `scripts/lib/taba-app-icon.mjs` · la geometría de la T, una sola vez
- `scripts/build-brand-app-icons.mjs` · genera los seis (`npm run pwa:icons`, `--check`)
- `scripts/verify-pwa-install.mjs` · comprobación en navegador real (`npm run pwa:verify`)
- `js/pwa-install-ui.js` · la hoja, los botones y la entrada del Perfil
- `tests/pwa-install-shell.test.mjs` · contrato de manifest, iconos y shell
- `tests/e2e/pwa-install.spec.mjs` · 14 casos en Chromium **y** en WebKit

**Modificados** — `manifest.webmanifest`, `index.html`, `_headers`,
`js/app.js`, `js/core/pwa-install.js`, `sw.js`, `styles.css`,
`styles/{tokens,common,profile,brand-home}.css`, `pago/*/index.html`,
`release-identity.json`, `package.json`, `scripts/{preflight-staging-package,visual-polish-shots}.mjs`,
y siete archivos de test con tokens de versión clavados.

## El icono: la T que ya estaba aprobada

No se dibujó una T nueva. La que se publica es **la misma** que vivía dentro de
`assets/icon.svg` desde siempre —`M216 266h80v22h-28v44h-24v-44h-28v-22Z`—, de
la que salen las tres proporciones que definen el mark: alto/ancho 66:80, barra
un tercio del alto, asta 30 % del ancho. `tests/pwa-install-shell.test.mjs` lo
reproduce con la función y compara contra el archivo original.

Tres variantes, y cada una existe por una razón distinta:

- **`any`** — esquinas redondeadas (20 %), con alfa. La usa el escritorio tal
  cual llega.
- **`maskable`** — a sangre, sin alfa, T al 53 % del lienzo. Android aplica su
  máscara y sólo garantiza el círculo central del 80 %: la media diagonal de la
  T mide 176 px sobre un radio seguro de 205, así que **ninguna máscara le corta
  un brazo**. El test lo calcula, no lo afirma.
- **`apple`** — 180×180, a sangre y **sin canal alfa**: iOS pinta negro detrás
  de la transparencia de un `apple-touch-icon`.

Un tropiezo que quedó anotado en el generador: aplanar contra el rojo para
quitar el alfa **también aplanó las esquinas redondeadas del `any`** y devolvía
un cuadrado perfecto. Ahora sólo se aplana lo que no tiene transparencia.

## Manifest

`name` **La Taba** · `short_name` **La Taba** · `display: standalone` ·
`orientation: portrait` · `background_color` **#d0000d** (el rojo TABA) ·
`theme_color` `#11151b`, el **mismo** que el `<meta>` del documento · cuatro
iconos PNG (192/512 en `any` y en `maskable`).

Tres decisiones que conviene conocer antes de tocarlo:

1. **`start_url` y `scope` siguen siendo relativos** (`./index.html`, `./`). El
   sitio vive en la raíz de Cloudflare Pages y bajo un subdirectorio en GitHub
   Pages: una ruta absoluta funciona en uno y deja a la app instalada fuera de
   su propio alcance en el otro.
2. **No se agregó `id`.** El implícito es `start_url`, que es lo que ya estaba
   publicado; declararlo cambiaría la identidad de la app para quien ya la
   tuviera instalada. Y hay una trampa: `id` se resuelve contra el ORIGEN, no
   contra el manifest, así que un `"./index.html"` daría distinto en GitHub
   Pages que en Cloudflare.
3. **El manifest es la única pieza donde el nombre del COMERCIO le gana al del
   producto.** El resto del shell sigue diciendo "TABA2" (es la plataforma). Un
   icono en el teléfono de un cliente no puede llamarse por el nombre interno
   del sistema: lo que esa persona instaló es La Taba.
   `tests/taba2-catalog.test.mjs` deja escrita la excepción y su porqué.

`_headers` declara `Content-Type: application/manifest+json` y `Cache-Control:
no-cache` para el manifest: sin revalidar, un cambio de nombre o de icono nunca
llega a quien ya visitó el sitio.

## Detección

Todo el olfateo de user agent del cliente vive en **un solo archivo**,
`js/core/pwa-install.js`, y un test recorre `js/` para que siga siendo así.
`detectPlatform()` devuelve `isIOS`, `isAndroid`, `isDesktop`, `isMobile`,
`isStandalone`, `isIOSSafari` y `iosCapability`.

- **iPadOS 13+** se declara Mac de escritorio: se lo reconoce por
  `platform === 'MacIntel'` con `maxTouchPoints > 1`.
- **`isStandalone`** consulta `display-mode: standalone`, `fullscreen`,
  `minimal-ui` y `window-controls-overlay`, más `navigator.standalone` en iOS.
  Un lanzador puede abrir la app en cualquiera de esos modos y en todos ofrecer
  instalar sería absurdo.
- **`isDesktop` se define por exclusión**: "no es ninguno de los dos teléfonos
  que sabemos reconocer". Un híbrido con Windows cae ahí, y está bien: la
  instalación se la ofrece `beforeinstallprompt` igual que a cualquier
  escritorio.
- **`iosCapability`** distingue `safari` / `browser` / `webview`, que es lo que
  permite no mandar a nadie a buscar un botón que no existe.

## Android

1. `beforeinstallprompt` → `preventDefault()` → se guarda el evento.
2. La hoja se abre con **Llevá La Taba con vos** / *Agregá La Taba a tu celular
   para entrar más rápido a tus pedidos.* / **Instalar La Taba** / **Ahora no**.
3. `prompt()` se llama **sólo** desde el toque. La referencia se suelta **antes**
   de esperar el resultado: el evento es de un solo uso.
4. `accepted` → se recuerda; `dismissed` → se recuerda; error → no se recuerda
   nada, porque no hubo decisión.
5. `appinstalled` → cierra la hoja, guarda `installed`, retira la entrada del
   Perfil y avisa con un toast.

**Sin `beforeinstallprompt` no se ofrece nada.** Ni hoja, ni entrada de Perfil,
ni un botón que no instale. Es el caso de Firefox para Android y de cualquier
navegador que decidió no ofrecerla.

## iPhone / iPad

No hay prompt y no se finge uno: el botón nativo directamente **no se dibuja**
(hay un test para eso). Se ofrece **Agregá La Taba a tu inicio** / *Tené La Taba
como una app en tu iPhone.* / **Ver cómo**, y "Ver cómo" abre los tres pasos
—Compartir → Agregar a pantalla de inicio → Agregar— con el glifo real de cada
uno y el número puesto por un contador de CSS.

La guía se adapta al navegador REAL: en Safari el Compartir "está en la barra de
abajo", en Chrome/Edge/Firefox para iOS "en el menú de tu navegador", y dentro
del WebView de otra app aparece un aviso que dice que primero hay que abrirla en
Safari. **En un WebView no se invita solo**: ahí la opción no existe.

**Nunca se afirma que quedó instalada.** Eso sólo se sabe cuando una apertura
posterior se detecta en standalone.

Metadatos: `apple-touch-icon` PNG de 180, `apple-mobile-web-app-capable`,
`mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style:
black-translucent` y `apple-mobile-web-app-title = TABA` (lo mismo que
`short_name`, para que la app no se llame distinto según el teléfono).

## Comportamiento instalado

`js/app.js` marca `html[data-taba-display-mode]` al arrancar y **eso es todo lo
que cambia**. El único ajuste visual es el borde superior: con
`viewport-fit=cover` y la barra translúcida de iOS, instalada la app dejaba el
reloj y la batería encima del nombre del comercio. En ese modo —y **sólo** en
ese modo, así que la pestaña conserva la geometría certificada— `.topbar` suma
`env(safe-area-inset-top)` y `--topbar` crece lo mismo, de modo que su alto útil
sigue siendo 56 px y todo lo que se deriva de ese token sigue cuadrando.

Ningún enlace interno abre pestaña nueva: los ocho `target="_blank"` del
repositorio son Google Maps y WhatsApp, que corresponde que salgan. Lo comprueba
`npm run pwa:verify` sobre el DOM servido.

## Cuándo aparece, y cómo no vuelve

Primera visita desde móvil, **2,5 s después de que la tienda terminó de
armarse**, y sólo si el momento está libre. "Libre" son cuatro condiciones que
se comprueban **justo antes de abrir**, no cuando se programa:

- el arranque terminó (`data-app-bootstrap="ready"`);
- no hay ningún `<dialog>` abierto;
- la vista es inicio, catálogo o perfil —**el carrito es el checkout y el
  seguimiento es un estado vivo**—;
- y hace **1,5 s que nadie toca ni teclea**.

Esa última condición no estaba en el plan: la agregó un defecto medido. En
WebKit móvil la hoja se abrió **encima del "+"** mientras alguien sumaba
unidades en la góndola, y se quedó con el toque siguiente. Estar en una vista
permitida dice dónde está la persona; no dice si está haciendo algo. Si el
momento no está libre se reintenta cada 2 s, con dos disparadores distintos —el
reloj para "dejó de tocar", el observador de la vista para "salió del
checkout"— durante 20 s; después se abandona por esta visita.

La decisión se guarda en **`TABA_INSTALL_PROMPT_V1`** (localStorage), como
`{ v, decision, at, platform }` con `decision` ∈ `declined` | `accepted` |
`installed`. Cualquiera de las tres apaga la invitación automática **para
siempre**; ninguna apaga la entrada del Perfil. Las dos claves de la versión
anterior se leen una vez —para no volver a molestar a quien ya había cerrado el
aviso viejo— y no se reescriben. Un JSON corrupto o un almacenamiento bloqueado
equivalen a "todavía no le preguntamos", que es el estado seguro.

## La opción manual

**Perfil → una tarjeta propia**, entre los datos del cliente e "Información del
local". Comparte material con sus vecinas: no parece un aviso, parece una fila
más de la cuenta. Dice **Instalar La Taba** en Android y escritorio, y **Agregá
La Taba al inicio** en iOS.

Nace oculta y sólo se muestra cuando hay una instalación real que ofrecer: con
la app ya instalada, o en un navegador que no puede instalarla, **no se dibuja**.
Desde el Perfil, Android va **directo al prompt nativo**: quien tocó ahí ya
pidió instalar, repetirle la pregunta sería un paso de más.

## Resultados

| Suite | Resultado |
| --- | --- |
| `npm run check` (7 guards) | **verde** |
| `npm test` | **1829 / 1829** |
| E2E Chromium (3 shards) | **346 pasan · 1 falla preexistente** |
| E2E mobile-webkit | **99 / 99** (85 + los 14 nuevos) |
| `npm run pwa:verify` | **todo en orden** (18 comprobaciones) |

No hay lint ni typecheck en el proyecto; `npm run check` es su equivalente
(sintaxis, assets estáticos, grafo de precache, higiene de release, identidad de
release, contrato de ubicación y escaneo de secretos). El "build" es
`create-release-folder`, que no se corrió porque no hay publicación en esta
tarea.

**La falla preexistente** es
`beverage-storefront.spec.mjs › la imagen de un producto real se reutiliza…`:
espera la foto de una Heineken y recibe el placeholder. **Falla idéntica en la
base `34c6ee3`**, verificado corriéndola ahí. Es consecuencia del trabajo de
derechos de imagen, no de esto.

**Un rojo preexistente que sí se cerró**: `ios-blank-screen.spec.mjs` interceptaba
`js/app.js?v=42` cuando el shell ya iba por `?v=44`, así que la intercepción no
matcheaba nada y el test fallaba pidiendo un panel de recuperación que no tenía
por qué aparecer. O sea que **la red de seguridad del arranque llevaba dos
publicaciones sin probarse**. Ahora la ruta se declara por expresión regular y
el próximo bump no la vuelve a apagar.

**El arnés corre como quien ya respondió.** `playwright.config.mjs` siembra
`TABA_INSTALL_PROMPT_V1` con `declined` en el `storageState` de TODO el gate, y
`pwa-install.spec.mjs` lo vacía para medir una primera visita de verdad.
`installBrowserStubs` —que limpia el almacenamiento en cada navegación— lo
vuelve a sembrar con `skipInstallInvitation`.

No empezó así: primero se parchearon los dos specs que fallaban. Fue
insuficiente y el segundo síntoma lo demostró: `service-worker-degraded-recovery`
perdió UN toque de los dos que daba —"agregué 2, llegó 1"— en una corrida y pasó
en la siguiente. **Diez archivos de WebKit son candidatos y el que se olvide va a
fallar una vez cada tantas corridas**, que es la peor forma de fallar. El
`storageState` cierra la clase entera de una vez. No es un interruptor de
prueba: es el estado exacto que deja alguien que tocó "Ahora no", con la entrada
del Perfil visible igual que para esa persona.

Identidad de release rotada: `la-taba-runtime-v78-pwa-instalable`, `?v=52` para
el CSS y `?v=45` para `app.js`, firmada con 130 archivos. `preflight-staging-package.mjs`
viaja con ella.

## Límites reales del navegador

- **Android**: `beforeinstallprompt` lo dispara Chrome cuando quiere, según
  criterios de interacción que ningún arnés reproduce. La tienda reacciona
  correctamente al evento; **que el evento llegue no depende de nosotros**.
- **Firefox para Android** no dispara el evento: instala desde su propio menú.
  Ahí no ofrecemos nada, a propósito.
- **iOS** no tiene ninguna API de instalación, ni evento, ni forma de saber si
  la persona completó el gesto. La única señal es standalone en una apertura
  posterior.
- **WebViews embebidos** (Instagram, WhatsApp, Facebook) no pueden agregar al
  inicio en iOS.
- El arnés **no emula `env(safe-area-inset-*)`**: en Playwright valen 0. El
  ajuste de la barra en standalone está escrito y probado como contrato, pero su
  medida real sólo se ve en un iPhone con notch.

## Prueba física pendiente

Nada de esto reemplaza el teléfono. Queda por hacer, sobre el sitio publicado
(HTTPS es requisito de instalación):

1. **Moto G15 / Chrome** — visitar, esperar la invitación, instalar, comprobar
   que el icono es la T blanca sobre rojo **sin recorte**, que abre sin barra
   del navegador, que la etiqueta dice "La Taba" y que no vuelve a invitar.
2. **iPhone / Safari** — visitar, "Ver cómo", hacer el gesto, y **volver a
   abrir desde el icono**: recién ahí se puede afirmar que quedó instalada.
   Mirar el borde superior: el reloj no puede pisar el nombre del comercio.
3. **iPhone / Chrome** — que el texto diga "en el menú de tu navegador".
4. **Instalada, en los dos** — login, un pedido de punta a punta y el
   seguimiento, para confirmar que la sesión y las rutas sobreviven al modo app.

Nada de esto se puede declarar cerrado desde acá.

## Qué NO se hizo

No hay APK, ni Capacitor, ni Cordova, ni dependencias nuevas (`sharp` y
`@playwright/test` ya estaban). No se tocó el backend, ni un contrato, ni una
migración. No se reescribió el storefront: la app se comporta igual, salvo la
hoja de instalación y una tarjeta más en el Perfil. Sin push y sin deploy.
