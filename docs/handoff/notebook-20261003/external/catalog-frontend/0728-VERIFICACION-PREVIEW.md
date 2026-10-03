# Verificación del preview publicado — TABA2 catálogo

**URL** `https://d6635263.taba2-staging.pages.dev`
(alias `https://feature-taba2-catalog-visual.taba2-staging.pages.dev`)

**Proyecto** Cloudflare Pages `taba2-staging` · **entorno** Preview
**Rama** `feature/taba2-catalog-visual-polish` · **fuente** `eed44a6`
**Deployment id** `d6635263-dfb1-4078-931f-1403467cf5fc`

Motor de la verificación: WebKit con forma de iPhone (390×844, dscale 2),
contra el servidor publicado, no contra el repo.

---

## Comprobaciones funcionales (11/11)

    OK    la home abre y pinta la marca
    OK    el CSS servido es el del pulido (tokens nuevos aplicados de verdad)
    OK    el catálogo abre con producto real del backend
    OK    el "Agregar" es la píldora nueva y el precio la tipografía nueva
    OK    los filtros abren y aplican
    OK    tocar "Filtros" cierra el panel y devuelve el toque a la grilla
    OK    el orden cambia la grilla
    OK    el carrito suma
    OK    Perfil abre
    OK    el service worker no deja una versión anterior pegada
    OK    recarga en caliente: con el worker ya activo la tienda vuelve entera

El arnés se colgó DESPUÉS de la última comprobación, cerrando el navegador
(WebKit + service worker en Playwright). No es del sitio: las once ya habían
pasado y las capturas quedaron escritas. El carrito se volvió a comprobar
aparte, con el worker bloqueado y plazos cortos, y dio verde por su cuenta:

    producto            : Red Bull Energy Drink
    contador carrito    : 0 -> 1
    stepper             : radio 999px, "1 +"
    líneas en el carrito: 1
    errores de página/red: 0

---

## Que el CSS que llega es el nuevo, medido y no supuesto

No se comprobó "que el archivo esté": se leyó el valor **computado** en el
navegador, que es lo único que prueba que no hay una hoja anterior ganando.

| | valor vivo |
|---|---|
| `--control-h` | `48px` |
| `--radius-control` | `14px` |
| `--card-pad` | `10px` |
| alto real del buscador | `48px` |
| radio del "Agregar" | `999px` (era `10px`) |
| tamaño del precio | `18px` (era `17px`) |
| borde izq. plato / título | `23` / `23` (compartían mal) |

Y los trece `@import` de `styles.css` responden `200 text/css` en el preview.

**Control negativo**: la producción del proyecto (`taba2-staging.pages.dev`)
sigue sirviendo el CSS ANTERIOR — `grep` de los tokens nuevos da 0 en
`tokens.css` y `catalog.css` de esa URL. Es la prueba de que el preview no la
tocó.

---

## Caché: por qué NO hizo falta ningún bump

Se dejó `?v=49` y `CACHE_NAME` como estaban, a propósito, y está medido:

1. el preview vive en **otro origen** (`d6635263.taba2-staging.pages.dev`), y
   el alcance de un service worker es por origen: ahí no había ninguno
   instalado. Medido después de cargar: **una sola caché**
   (`la-taba-runtime-v61-cliente-comercial-mapa-permanente`), ningún worker en
   espera, ninguna versión anterior pegada;
2. Cloudflare Pages sirve `Cache-Control: public, max-age=0, must-revalidate`,
   así que cada hoja revalida contra el origen.

La recarga en caliente —con el worker ya activo— devolvió el catálogo entero y
`--control-h` siguió en `48px`. Un bump habría sido ruido: rota la caché de
todos los clientes sin cambiar un archivo.

**Ojo si esto se publica algún día a la producción del proyecto de staging**:
ahí sí hay un worker instalado en el iPhone y el `?v` de `styles.css` **no
protege a sus trece `@import`** (cada uno es su propia URL). Ese despliegue
necesita el bump de `CACHE_NAME`; este no.

---

## Red y consola

- peticiones fallidas: **0**
- respuestas ≥400: **0**
- errores de consola: **0**

---

## Lo que este preview NO puede mostrar

- **El backend de staging tiene 8 productos con precio publicado y varios sin
  foto.** La grilla se ve con menos densidad que las capturas de la demo y con
  el plato vacío en los SKU sin imagen. Es dato del backend, no del pulido: la
  calidad del packshot conviene mirarla donde haya fotos.
- El aviso de actualización sólo aparece cuando hay un worker en espera. Para
  verlo hay que cargar, publicar de nuevo y volver a entrar; en las capturas de
  la rama está forzado.

---

## Artefactos

- `qa/preview-catalogo.png`, `qa/preview-home.png`, `qa/preview-carrito.png`
- arneses: `verify-preview-deploy.mjs`, `verify-preview-cart.mjs`
  (se dejaron FUERA del repo a propósito, para que el árbol quede exactamente
  en `eed44a6`, que es el SHA desplegado)
