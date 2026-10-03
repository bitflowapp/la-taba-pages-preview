# TABA — Cierre visual "Mostrador Patagónico"

Worktree: `C:\1212\la-taba-mostador-patagonico`
Rama: `feature/mostrador-patagonico-v1`
HEAD: `425c4aedd9b5d3b418e7949cf1f511c8077368b4` (sin commits nuevos)

Los cambios de la fase anterior se conservan íntegros. No se rediseñó el
catálogo ni el escritorio: sólo se corrigieron los tres puntos pedidos y los
defectos medidos durante su validación.

---

## 1 · Header operativo en Negocio y Repartidor

El app bar del cliente hablaba de la entrega de un cliente dentro del panel del
local: `ENVIAR A / Elegí tu dirección`.

- El control de dirección se retira en `business` y `rider`
  (`styles/responsive.css`).
- En su lugar aparece un bloque operativo con **marca TABA**, **contexto del
  local** y **estado real de sincronización**, más el conmutador de sonido:

  ```text
  [TABA] [OPERACIÓN DEL LOCAL / Hoy, 31 de julio · 1 pedido nuevo] [Sólo este equipo] [🔊 1]
  ```

- El estado de sincronización usa la **misma fuente que el resto de la app**
  (`getRealtimeStatus()` + `relayStatusLabel()`): sin relay dice `Sólo este
  equipo`, que es la verdad, y con relay dice `Sincronizado · 14:32`,
  `Reconectando` o `Sin conexión`. No se inventa un genérico "actualizando".
- Las vistas de cliente no cambian: `[data-topbar-ops]` sólo se muestra en
  Negocio y Repartidor, y el conmutador de sonido sólo en Negocio.
- Verificado en Catálogo: `opsHidden=true`, control de dirección visible.

## 2 · Negocio móvil

- **Cero tabs horizontales cortadas.** La banda operativa pasa de una fila con
  scroll a una **grilla de 4 columnas** (2 filas para los 7 estados), con las
  etiquetas completas en dos líneas. Por debajo de 320px cae a 2 columnas.
- **Navegación jerárquica aprobada**: barra inferior fija de **cuatro
  destinos** — Pedidos · Métricas · Caja · Local — y la sección **Local** con
  filas agrupadas de 56px (Catálogo, Promociones, Reportes, Configuración,
  Guía). La fila completa de secciones se conserva en escritorio.
- **Contratos `data-*` preservados**: ningún `data-business-view` cambia de
  valor; `data-scroll-catalog`, `data-scroll-reports` y
  `data-scroll-business-setup` siguen presentes en las mismas secciones.
  Cambia dónde vive cada botón, no su contrato.
- **Estados legibles completos** en 320×700 y 360×800: `Todos`, `Nuevos`,
  `En preparación`, `Listos`, `En reparto`, `Finalizados`, `Cancelados` sin
  recortes (medido: 0 textos cortados).
- **`Aceptar pedido` visible sin scroll** en 320×700, 360×800 y 390×844. Se
  logró liberando presupuesto vertical (la fila de fecha/sonido subió al app
  bar), no con una superficie fija que tape información.
- **Targets ≥44px**: 0 controles por debajo del umbral en todas las capturas.

## 3 · Catálogo

- `Recomendado` deja de recortarse: el `select` pasa a 148px en escritorio
  (16px de fuente, sin truncar) y en móvil el control dice **`Ordenar`** y abre
  las opciones nativas cubriendo todo el objetivo táctil de 44px.
- Categorías: **máscara de degradado** en los últimos 28px del borde derecho
  más **`scroll-snap: inline proximity`**; la máscara se retira a partir de
  900px, donde ya no hay desbordamiento que señalar.
- No se tocaron datos ni imágenes.

## Defectos medidos durante la validación y corregidos

| Defecto | Causa | Corrección |
|---|---|---|
| Rail "Destacados" con el nombre y el precio recortados y el packshot encima del texto | La regla del packshot del catálogo (`.thumb-img`, posición absoluta) alcanzaba a las imágenes de la Home, que comparten la clase sólo para heredar el respaldo de imagen rota | La regla se acota a `.thumb .thumb-img`, la caja real del packshot |
| Nombre del rail partido a la mitad ("Coca-Cola O") | `overflow-wrap: anywhere` global de `strong` + caja de 82px | Caja de 248×92 con copy de 110px y `overflow-wrap: break-word` |
| Buscador de la Home con fuente de 14px | Regla heredada | 16px, como el resto de los campos |
| Resumen del pedido en Seguimiento recortado ("6 productos · Total $20.") | `white-space: nowrap` + elipsis | Dos líneas, importe completo |
| Marca de verificación de Perfil recortada en su círculo | Glifo de 16px en caja de 28px | 14px con `line-height: 1` |
| Reserva inferior del panel de 28px frente a una barra de 56px | Regla heredada de `responsive.css` | `calc(var(--nav-h) + var(--safe-b) + var(--stack-gap))` |

## Validación

```text
npm run check      → Release hygiene check passed
npm test           → tests 605 · pass 605 · fail 0
git diff --check   → sin problemas
node tools/capture.mjs → capturas=17 fallos=0
```

E2E focales (workers=1): **102 pruebas, 0 fallos** sobre 27 spec files —
catálogo, carrito, checkout, negocio, Perfil, showcase, responsive, tracking,
promociones, sandbox y arranque.

> Nota: en una corrida con varios workers en paralelo,
> `direct-ordering-growth.spec.mjs` falló una vez por cruce de estado entre
> workers sobre el mismo servidor de demo. Reejecutado en aislamiento y en
> serie, pasa. No es una regresión de estos cambios.

### Medición por captura

Las 17 capturas registran **0 desbordamiento horizontal, 0 textos cortados,
0 objetivos táctiles por debajo de 44px, 0 campos por debajo de 16px,
0 solapes con superficies sticky, 0 errores de consola y 0 `pageerror`.**

Evidencia de máquina en `capture-results.json`.

| Captura | Acción primaria visible |
|---|---|
| `home-mobile-390x844` | — |
| `checkout-mobile-390x844` | 1 (`Confirmar pedido`) |
| `profile-addresses-390x844` | — |
| `tracking-on-the-way-390x844` | — |
| `tracking-arriving-390x844` | — |
| `business-mobile-320x700` | 1 (`Aceptar pedido`) |
| `business-mobile-390x844` | 1 (`Aceptar pedido`) |
| `business-mobile-order-390x844` | 1 (`Aceptar pedido`) |
| `business-desktop-1024x768` | 1 (`Aceptar pedido`) |
| `business-desktop-1280x900` | 1 (`Aceptar pedido`) |
| `business-desktop-1440x1000` | 1 (`Aceptar pedido`) |
| `business-desktop-1920x1080` | 1 (`Aceptar pedido`) |
| `catalog-mobile-*`, `catalog-desktop-1280x900` | — (el catálogo no tiene acción primaria de pantalla) |

### Correcciones al validador

Se corrigieron tres falsos positivos del medidor: el contenido de un
`<details>` cerrado y el texto `.sr-only` conservan caja medible en Chromium
pero no se ven; y una superficie sticky no se tapa a sí misma. El objetivo
táctil de un radio o checkbox se mide sobre su `<label>`, que es el área real.

## Riesgos pendientes

- Los packshots conservan su margen blanco horneado: **no se normalizaron en
  esta tarea**, como pide la consigna.
- El precio del rail de la Home sigue en rojo mientras la tarjeta del catálogo
  lo muestra en tinta. Es una inconsistencia heredada de la Home, fuera de los
  tres puntos de este cierre.
- Sin prueba en dispositivo físico: safe area real, teclado abierto,
  TalkBack/VoiceOver y zoom.
- No se ejecutaron las dos suites E2E completas.
