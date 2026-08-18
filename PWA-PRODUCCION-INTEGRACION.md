# La Taba instalable, sobre la producción vigente — integración

**Rama** `feature/taba2-pwa-production-integration`, desde
`feature/taba2-gondola-comercial-neuquen @ 786e6a6` — **la producción manda**.
HEAD `879706c`, 8 commits propios, **sin push**, **sin merge a main**,
**0 migraciones**, **0 mutaciones de base**, **0 mutaciones de catálogo**.

**Publicado**: Cloudflare Pages, proyecto `la-taba`, rama `main`,
despliegue `57f5a27e` → <https://la-taba.pages.dev>.

---

## 1. La ancestría, medida antes de tocar nada

El pedido avisaba que no se podía desplegar `105f85a` encima de producción, y
tenía razón por una razón concreta: **las dos ramas son hermanas, no una
descendiente de la otra**.

| | |
| --- | --- |
| autoridad productiva | `feature/taba2-gondola-comercial-neuquen @ 786e6a6` |
| fuente PWA | `feature/taba2-pwa-installable @ 105f85a` |
| merge-base | `34c6ee3` |
| exclusivos de cada lado | dos commits cada una, sin cruce |

O sea: **la rama PWA no contiene la góndola** (llevaría producción de 56
productos a 4) y **la góndola no contiene el PWA**. Por eso no se desplegó la
rama vieja ni se hizo cherry-pick a ciegas: se partió de `786e6a6` y se portó
el trabajo PWA **encima**, archivo por archivo.

## 2. Lo que se corrigió del trabajo portado

- **La línea de fin de archivo.** Cuatro archivos habían perdido su CRLF
  original y ensuciaban el diff con **823 líneas fantasma** —
  `playwright.config.mjs` y las dos suites del worker eran reescrituras
  completas de las que sólo 2 líneas eran reales—. Se restauraron byte a byte.
- **El nombre bajo el icono.** El port traía `short_name` `"TABA"`. El
  objetivo pide `La Taba`, y como todavía **no hay nadie con la app
  instalada**, cambiarlo no le rompe la identidad a ningún cliente. Ahora el
  botón promete "Instalar La Taba" y la etiqueta bajo el icono dice lo mismo.
  `apple-mobile-web-app-title` acompaña.
- **`orientation`.** Producción declaraba `portrait-primary`; queda
  `portrait`, que es **menos** restrictivo (admite el teléfono dado vuelta).
  Se conserva porque no hay ni una regla de CSS pensada para el apaisado.

## 3. Lo que faltaba probar y ahora se prueba

Dos casos del pedido eran de **copia**, así que el módulo de decisión no
alcanzaba: `iosInstallCapability` ya distinguía los tres navegadores, pero
nada comprobaba que el texto cambiara.

- **iPhone/Chrome** — la guía manda al menú de SU navegador. Decirle "tocá
  Compartir en la barra de abajo de Safari" a quien está en Chrome es mandarlo
  a buscar un botón que en su pantalla no está.
- **iPhone dentro de otra app** — no se auto-invita, porque ahí "Agregar a
  pantalla de inicio" **no existe**; si la pide desde el Perfil, lo primero que
  lee es que tiene que salir a Safari.

Y el **control negativo** encontró un defecto en la herramienta: con el
manifest roto el verificador fallaba —bien— pero **moría con una traza de pila
y se llevaba puesto el informe entero**, que es justo lo que había que leer.
Corregido: ahora cada bloque falla por separado y el informe sale completo.

## 4. Números reales

| gate | resultado |
| --- | --- |
| `npm run check` | OK |
| `npm test` | **1861 / 1861** |
| `npx playwright test` (chromium + mobile-webkit) | **455 / 456** |
| `pwa-install.spec` sola, los dos proyectos | **32 / 32** |
| `npm run pwa:verify` (local) | todo en orden |
| `npm run pwa:verify -- --base https://la-taba.pages.dev` | todo en orden |
| `npm run production:live` | sin regresiones |

El único rojo del gate completo — `panel-responsive` › "el foco se ve y
recorre la navegación con teclado" — **pasa 12/12 corrido solo**. Es el falso
rojo conocido de esta máquina cuando algo corre en paralelo con el E2E; no toca
ninguna superficie de este trabajo.

### Controles negativos, los tres activos

| se rompe | resultado |
| --- | --- |
| se saca `taba-app-icon-512.png` | `FALLA … contestó 404`, salida 1 |
| manifest inválido | 6 fallas, incluida la de Chrome ("Line: 1, column: 22"), salida 1 |
| el worker guarda `/rest/v1/orders` | `FALLA el worker guardó 1 respuesta(s) de API`, salida 1 |

Los otros tres son pruebas verdes: Android sin `beforeinstallprompt` no dibuja
botón, el WebView no recibe invitación, y en standalone no aparece nada.

## 5. Medido en el sitio publicado

```
manifest      application/manifest+json; charset=utf-8   ← sale de _headers, o sea del borde
iconos        192/512 any · 192/512 maskable · apple-180   los cinco 200 image/png
              dimensiones reales verificadas en la cabecera IHDR
alfa          any = RGBA (esquinas) · maskable y apple = RGB opaco
scope         https://la-taba.pages.dev/
worker        activo y controlando · precache v79 · 131 entradas · 0 datos vivos
catálogo      33 productos · agregar y carrito andando
Auth          GoTrue HTTP 200
Panel         carga su pantalla de ingreso
consola       limpia
```

## 6. Lo que falta

**Prueba física.** El navegador reconoce la app y ofrece instalarla; que Android
la instale de verdad y que iOS la agregue al inicio **no se puede afirmar desde
acá**. Ver §"Prueba física" de `PWA-INSTALACION-HANDOFF.md`.

Al momento de escribir esto el Moto G15 **no estaba conectado**.
