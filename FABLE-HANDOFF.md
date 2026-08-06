# FABLE-HANDOFF · Pulido visual comercial TABA2

Entrega del worktree exclusivo `la-taba2-fable-visual-polish`, rama
`feature/taba2-fable-visual-polish`.

| | |
| --- | --- |
| Base | `6dd0565` — HEAD de `feature/taba2-commercial-storefront`, con su handoff (`HANDOFF.md`) incluido |
| HEAD final | El commit que agrega este archivo. `git log --oneline 6dd0565..HEAD` lista la entrega completa. No se fija acá por lo mismo que documenta el handoff anterior: un documento no puede contener el hash del commit que lo introduce. |
| Commits | Todos locales, listados por `git log --oneline 6dd0565..HEAD`. Sin push, sin merges. |
| Archivos | 11 sobre la base (`git diff --stat 6dd0565..HEAD`) |
| Git | Limpio. Sin `amend`, `reset`, `clean`, `stash` ni `git add .`. |

---

## 1. Qué clase de entrega es esta

La base ya traía la identidad de góndola completa (remapeo de tokens, ficha
con barra de compra, combos derivados del catálogo vivo, retornos de pago con
marca) y una auditoría de superficie en cero. Este pulido **no redecoró nada
de eso**: se auditó pantalla por pantalla contra la vara de "producto que se
vende a clientes reales" y se corrigieron los seis lugares donde el detalle
contradecía la calidad del resto. Cada uno es chico; juntos eran la diferencia
entre "buena app" y "terminada".

## 2. Decisiones visuales, una por una

### 2.1 El buscador era dos cajas

La regla de sub-superficies del scope cliente —la que garantiza que ningún
campo del checkout nazca blanco— pintaba también el input de los buscadores de
home y catálogo. Resultado: una caja grafito **dentro** de la píldora del
buscador, con su costura visible, y el anillo de foco dorado abrazando la caja
interna en vez del campo que se ve.

El input vuelve a ser transparente (con la especificidad exacta de la regla
que lo pintaba, para no depender del orden del archivo) y **el foco lo porta
la cáscara completa**: borde dorado y halo suave. El buscador del topbar de
escritorio nunca tuvo el problema —vive fuera de `.app-view`— y no se tocó.

Además, WebKit real (Safari/iPhone) seguía pintando su goma de borrar nativa
al lado de la ✕ propia: dos controles de borrado en el mismo campo.
`appearance: none` no la retira; `display: none` sí.

### 2.2 El favorito abría un agujero sobre la foto

El disco de favorito se pintaba grafito por la regla de "discos sobre el
packshot" del scope cliente. Pero el disco no está sobre la góndola: está
sobre el **plato blanco** de la foto. Un disco oscuro ahí es un agujero que
tapaba cintas y sellos del propio envase (la cinta MANGO LOCO de Monster, la
banda LAGER de Imperial): lo único que la tarjeta no puede permitirse tapar.

Sobre blanco el disco pasa a blanco translúcido con línea de pelo: presente
para el pulgar, invisible para la foto. La tinta del corazón se mide contra
ese blanco (el gris de base daba 2,9:1; `--taba-muted` da 4,5:1) y el favorito
activo conserva su rojo.

### 2.3 El toast cambiaba de lugar y tapaba lo único fijo del carrito

Por una excepción heredada, en el carrito el toast saltaba a la cabecera,
donde cubría "Tu pedido" y la fila de acciones. Era además el único componente
que cambiaba de posición según la vista. Ahora vive **siempre** sobre la
navegación inferior: abajo no pisa nada anclado, porque el contenido scrollea.

### 2.4 El mínimo de delivery parecía un cargo

En el resumen del checkout, "Pedido mínimo delivery $ 5.000" pesaba igual que
Subtotal y Envío: mismo cuerpo, monto en negrita, en la columna donde todo lo
demás se suma. Un número en negrita en la columna de montos **se suma solo**,
y "$ 5.000 de más" es exactamente la duda que un resumen de pago no puede
sembrar. Las filas informativas del resumen (`.muted`) se aflojan y achican
para leerse como nota al pie de la cuenta. El dato y el copy no cambian.

### 2.5 "Seguir" sin pedido era otra aplicación

La experiencia inmersiva de mapa esconde la navegación inferior para que el
estado y el mapa manden. Correcto **con** pedido. Pero el selector la escondía
también sin pedido en curso: el cliente que tocaba "Seguir" caía en una
pantalla casi vacía, sin barra, con un menú hamburguesa como único regreso.
La única vista de la app que rompía el shell. El vacío conserva la
navegación (`:not(.is-empty)`) **y su reserva inferior** —la regla que
anulaba el padding de `main` en seguimiento se escopa igual—; el pedido
activo conserva su inmersión completa.

### 2.6 Versión de caché

`CACHE_NAME` pasa a `la-taba-runtime-v46-pulido` y todas las hojas a `?v=42`,
mismo mecanismo que la entrega anterior: sin el bump, una PWA instalada
serviría los estilos viejos desde caché y no vería nada de esto.

## 3. Lo que se miró y se decidió NO tocar

Se recorrió cada pantalla pedida (home, categoría, producto, combo, carrito,
perfil, dirección, checkout, retornos de pago) a 320/375/390/414/432/1280 en
los dos motores. Lo que sigue se evaluó y se dejó como está, a propósito:

- **Hero de escritorio** (emblema + bienvenida en dos columnas): composición
  deliberada de la base; reorganizarla era riesgo sin señal clara de mejora.
- **"ENVIAR A" oculto en la home**: decisión documentada de la base (la barra
  no repite lo que el encabezado de marca ya dice). Consistente, no bug.
- **Menú hamburguesa del seguimiento con pedido activo**: parte de la
  composición inmersiva de mapa, con su propia cabecera silenciosa.
- **Trío "Editar / Eliminar / Usar esta" del perfil**: son text-buttons
  consistentes con el sistema y con blanco táctil correcto.
- **Combos, ficha de producto, retornos de pago, estados vacíos**: ya estaban
  al nivel; no se les cambió un píxel.
- **Motion**: la capa existente (active scale, hover lifts, reveals, guards de
  `prefers-reduced-motion`) está completa; no se duplicó nada.

## 4. Validación

### 4.1 Auditoría de superficie (contraste WCAG AA, superficies fuera de
identidad, overflow horizontal, blancos táctiles < 44 px)

```
node scripts/realtime-relay.mjs 8247 &
BASE=http://127.0.0.1:8247 npm run qa:taba2:commercial-audit
ENGINE=webkit WIDTHS=320,375,390,414,432,1280 BASE=http://127.0.0.1:8247 npm run qa:taba2:commercial-audit
```

| Motor | 320 | 375 | 390 | 414 | 432 | Escritorio |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Chromium | 0 | 0 | 0 | 0 | 0 | 0 |
| WebKit (Safari/iPhone) | 0 | 0 | 0 | 0 | 0 | 0 |

72 pares vista×ancho por motor (12 vistas × 6 anchos), todos en cero. La
corrida es POSTERIOR al último cambio de CSS de la rama. Overflow
horizontal 0 px también en iPhone 13 (WebKit) y Pixel 7 (Chromium) con sus
descriptores reales.

### 4.2 Suites

| Suite | Resultado |
| --- | --- |
| `npm run check` | Pasa |
| `npm test` | **1.028 pasan**, 0 fallan |
| `npx playwright test` | **204 pasan**, 0 fallan |

Tres specs se actualizaron al contrato nuevo:

- `tests/pwa.test.mjs` y `tests/github-pages.test.mjs` fijan los literales de
  versión del service worker; el contrato (grafo versionado completo) no
  cambió, cambió el valor (v45→v46, ?v=41→?v=42).
- `tests/e2e/la-taba.spec.mjs` codificaba la barra oculta en el seguimiento
  vacío; ahora asegura lo contrario —barra visible y reserva inferior— y
  sigue asegurando la inmersión sin barra que la experiencia de mapa exige
  para negocio y rider.

Nota de reproducción: en la primera corrida completa, dos specs ajenos al
cambio (`delivery-proof`, `direct-ordering-growth`) fallaron por contención
de CPU —esta sesión corría capturas en paralelo— y pasan aislados y en la
corrida completa limpia. Si la suite se corre junto a otra carga pesada,
puede repetirse.

### 4.3 Capturas

```
BASE=http://127.0.0.1:8247 npm run qa:taba2:commercial-screenshots
```

Salida en `artifacts/taba2-commercial-audit/final/`: por motor y ancho, las
dieciséis vistas del recorrido —incluida `14b-direccion`, el editor de
dirección que la entrega pedía y el recorrido no capturaba— más los cinco
estados del retorno de Mercado Pago y los dos dispositivos reales (iPhone 13
por WebKit, Pixel 7 por Chromium). Las imágenes no se versionan (`.gitignore`
ya excluye la carpeta); se versiona cómo regenerarlas.

## 5. Archivos de la entrega

**Identidad y componentes**
`styles/brand-home.css` (buscador de una superficie; favorito sobre plato
blanco) · `styles/common.css` (toast; goma de borrar nativa de WebKit) ·
`styles/checkout.css` (filas informativas del resumen) ·
`styles/responsive.css` (navegación en seguimiento vacío)

**Versionado**
`styles.css` · `sw.js` · `index.html` (v46 / ?v=42)

**Validación**
`tests/pwa.test.mjs` · `tests/github-pages.test.mjs` ·
`tests/e2e/la-taba.spec.mjs` ·
`scripts/taba2-commercial-screenshots.mjs` (captura del editor de dirección)

## 6. Riesgos para integración

1. **El deploy tiene que publicar `sw.js` junto con los estilos.** Igual que
   en la entrega anterior (§5.4 del handoff base): si se publican los estilos
   sin el service worker nuevo, las PWA instaladas mezclan versiones.
2. **Conflicto previsible con la base si avanza en paralelo.** Los cambios
   viven en cuatro hojas muy activas (`brand-home.css`, `common.css`,
   `checkout.css`, `responsive.css`) y en los literales de versión que la
   base también toca en cada entrega (`?v=`, `CACHE_NAME`, y sus dos tests).
   Son conflictos triviales de resolver, pero van a aparecer.
3. **La regla del favorito asume plato blanco.** Si alguna vez el packshot
   deja de vivir sobre plato blanco (fotos con alfa sobre grafito), el disco
   blanco translúcido pasa a ser el parche. La regla está comentada con esa
   condición al lado.
4. **Nada de esta rama toca datos, pagos, pedidos ni backend.** Todo es CSS,
   una línea de HTML (versión de la hoja), dos tests de contrato y el script
   de capturas. Los bloqueos comerciales del handoff base (combos sin cobro
   de descuento, unidades sin precio) siguen exactamente donde estaban.

---

TABA2_FABLE_COMMERCIAL_VISUAL_POLISH_READY_FOR_INTEGRATION
