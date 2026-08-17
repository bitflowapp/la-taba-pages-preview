# Integrar el Panel comercial a la línea de producción

Esta rama **no está integrada**, y no debería estarlo hasta que las cinco
condiciones de abajo estén cumplidas. Nada de lo que sigue es urgente: la línea
de producción avanza sin esto.

## Dónde está cada cosa

| | |
|---|---|
| rama | `feature/taba2-business-commercial-mobile` |
| worktree | `D:/1212/worktrees/taba2-business-commercial-mobile` |
| base | `dae5a21` — `release/taba2-production-external-enablement`, la autoridad de la línea RC2 en el momento de abrir la rama |
| destino previsto | la misma línea, cuando avance |

La base es `dae5a21` y no el tip actual de la release a propósito: los commits de
Track A —herramientas de conexión productiva— y los de Track B —interfaz— no
comparten un solo archivo, así que integrarlos por separado es posible y
revisarlos por separado es más barato.

## Los seis commits, en orden

| commit | qué toca |
|---|---|
| `c10d1fc` | tokens y tema del Panel · `styles/tokens.css`, `styles/business.css` |
| `7825257` | navegación de teléfono · `js/production-operations.js`, cadena de versión de assets |
| `badca27` | tablero de pedidos · `js/production-operations.js`, `js/state.js` |
| `2f59bc7` | pruebas responsive y escritorio · `tests/e2e/`, `scripts/lib/` |
| `a095cd0` | densidad medida, escritorio y Tauri · `src-tauri/tauri.conf.json` |
| `0c0dba7` | informe |

Ninguno mezcla las dos cosas. `7825257` arrastra el cambio de identidad de
release porque cambiar CSS lo obliga, y eso toca siete archivos de prueba que
fijaban `?v=50` a mano.

## Lo que hay que resolver ANTES de integrar

### 1. La cadena de versión de assets choca, siempre

Esta rama subió `CACHE_NAME` a `la-taba-runtime-v72-business-commercial-mobile` y
la cadena de CSS a `?v=51`. La línea de producción está en
`la-taba-runtime-v71-production-rc2` con `?v=50`.

**Al integrar hay que volver a decidir el nombre**, no aceptar el de la rama: la
identidad de release nombra un artefacto publicable, y `v72-business-commercial-mobile`
no es el nombre de un candidato de producción. El orden correcto es:

```
git merge --no-ff feature/taba2-business-commercial-mobile
# resolver CACHE_NAME a mano: v72-<nombre-del-candidato>
node scripts/check-release-identity.mjs --write
npm run check && npm test
```

`tests/release-payment-return-package.test.mjs` ya no necesita edición: se
arregló para leer la versión del propio preflight en vez de fijarla.

### 2. Una prueba de la suite E2E completa, con la máquina libre

La nota de `dae5a21` deja medido que la suite entera es sensible al tiempo:
verde y exit 0 las dos veces que la máquina estuvo libre, frágil las dos que no.
La corrida de esta rama tiene que hacerse en las mismas condiciones o el
resultado no dice nada.

### 3. Una revisión en un teléfono de verdad

Todo lo de esta rama se midió en Chromium con emulación táctil. El teclado
virtual, el rebote del scroll de iOS y el recorte del notch se comportan distinto
en un aparato. El preview está publicado para eso:

**https://taba2-panel-mobile-preview-2.taba2-staging.pages.dev/#business**

Lo que conviene mirar, en ese orden: que entre un pedido y se vea sin scrollear;
que «Aceptar pedido» se toque con una mano; que la hoja de «Más» no tape la barra
de gestos; que el ingreso funcione con el teclado abierto.

### 4. Tauri, corrido de verdad

`minWidth` pasó de 1024 a 1100 y el bundle de escritorio se regeneró, pero **no
se compiló el instalador**: eso necesita la cadena de Rust y los cinco secretos
de firma, que no están en esta máquina. Lo que sí está comprobado es que
`dist-desktop` sirve la hoja nueva y que la prueba de contrato ata el ancho
mínimo con el corte móvil del CSS.

Antes de integrar conviene abrir la aplicación de escritorio una vez y arrastrar
la ventana hasta su mínimo: tiene que seguir mostrando la fila de destinos, no la
barra inferior.

### 5. El Panel de demostración no se tocó, y hay que confirmarlo

`js/business.js` —la «Central de pedidos» con pestañas, la que usan
`business-inbox.spec.mjs` y compañía— no tiene un solo cambio. Sigue siendo la
superficie de `?demo=1` y sigue siendo clara.

Eso es deliberado: el Panel comercial es el de producción. Pero conviene que la
corrida completa de E2E lo confirme, porque las dos superficies comparten
`styles/business.css` y el retematizado está acotado por
`body[data-active-view="business"]`, que **también** cubre al panel de
demostración cuando la vista activa es `business`.

> Medido: el panel de demostración vive dentro de `[data-view="business"]`, así
> que hereda el tema grafito. No es un accidente —es la misma pantalla del mismo
> negocio— pero es un cambio visual en una superficie que esta rama no se propuso
> tocar, y la revisión tiene que verlo antes de aceptarlo.

## Lo que NO hay que hacer

- **No integrar a `main`.** Nada de esta rama va a `main`.
- **No publicar el preview como alias de staging.** El deployment es de rama y
  el alias `taba2-staging.pages.dev` no se movió; tiene que seguir así.
- **No apuntar el preview a producción.** El Panel escribe: aceptar un pedido,
  asignar un rider y cancelar son mutaciones reales.

## Orden sugerido

1. Correr la suite E2E completa de esta rama con la máquina libre.
2. Revisar el preview en un teléfono.
3. Abrir la aplicación de escritorio y arrastrar la ventana al mínimo.
4. Mirar el panel de demostración en grafito y decidir si se acepta.
5. Recién ahí, integrar con `--no-ff` y renombrar la identidad de release.
