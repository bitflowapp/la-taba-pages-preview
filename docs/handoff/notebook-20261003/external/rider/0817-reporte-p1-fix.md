# Corrección de los dos P1 — TABA2 Rider Commercial Redesign

**TABA2_RIDER_COMMERCIAL_REDESIGN_PHYSICALLY_REVIEWED**

Fecha: 2026-08-05. Sin push. Sin deploy. Staging intacto.

---

## 1–3. Worktree, rama y HEAD

| | |
|---|---|
| Worktree | `D:\1212\worktrees\taba2-rider-commercial-p1-fix` |
| Rama | `fix/taba2-rider-commercial-review-p1` |
| HEAD inicial | `d1ce78e814b59ee7df1befdcc8e2a31c23912c3a` |
| HEAD final | `9b498db2a75e5ff4a4bb93e0d502d0b5f2848109` |
| Worktree revisado | `d1ce78e`, limpio — **no se modificó** |
| `taba2-rider-map` | `95294d9` — intacto |
| `la-taba-rider-smoke-automation` | `8e2b671` — intacto |

Sin `reset`, `clean`, `stash`, `amend`, `git add .`, push ni deploy.

## 4. Solución P1-1 — pedidos adicionales ocultos

**Causa.** El recuento y el enlace vivían dentro del `SingleChildScrollView`
del sheet, así que con el sheet colapsado quedaban bajo el pliegue: tres
pedidos se veían igual que uno.

**Corrección.**

1. `RiderSheet` recibe una ranura `secondary` **fijada** entre el cuerpo
   scrollable y el footer.
2. `RiderMapView` expone `secondaryAction` (botón contorneado de 48 dp) y
   `trailingBadge` (píldora `+N` junto al código).
3. `RiderHomePage` calcula `extra = state.available.length - 1` **de la lista
   real**. Con un pedido no se dibuja ninguno y no se reserva espacio.
4. El sheet colapsado **crece exactamente la altura de la fila que agregó**, y
   sólo cuando esa fila existe. El crecimiento se aplica **después** del tope
   del 62 %, porque plegado dentro de él la pantalla chica se comía el aumento
   y la fila nueva seguía costando una parada. Un techo propio del 72 %
   mantiene el mapa presente.

**Defecto bloqueante encontrado al probar esta ruta.** Abrir Entregas lanzaba
`setState() called during build`: `OrdersPage.initState` cargaba el
`OrdersController` **compartido** de forma síncrona y esa notificación
reconstruía el mapa mientras la ruta nueva se construía. Sin corregirlo, P1-1
no funcionaba. Cambio mínimo: la carga corre después del frame.

## 5. Solución P1-2 — controles sobre el texto al 150 %

**Causa.** El rail y la superficie de reemplazo comparten el mismo `Stack`. La
superficie usaba todo el ancho y el rail se dibuja después, encima. No había
desbordamiento, por eso ninguna prueba lo veía.

**Corrección (en dos pasos; el primero resultó incompleto).**

1. `Taba2MapGeometry` declara **una sola vez** el ancho de la banda del rail y
   la separación mínima.
2. El rail se posiciona con `_railBottomFor(...)`, con un techo calculado desde
   el inset superior real, la barra superior y los controles que efectivamente
   muestra (2 o 3 según haya navegación).
3. El `bottomInset: 88` mágico pasó a ser `_attributionClearance`, calculado
   desde tokens y escala de texto.

**Lo que faltaba.** Renderizar el arreglo antes de llevarlo al teléfono mostró
que era medio arreglo: el rail ya no tapaba el mensaje, pero a 150 % en 320 dp
la **cápsula de estado** se apoyaba sobre el título y la **atribución** sobre
la última línea. Mismo defecto, otro control.

4. La superficie reserva **todas** las bandas que se dibujan sobre ella y la
   reserva se movió **fuera** del `SingleChildScrollView`. Como padding de
   scroll viajaba con el contenido, así que un mensaje más alto que el área
   libre seguía pasando por debajo del chip.
5. El límite superior se calcula desde la **cápsula**, no desde los círculos de
   48 dp, porque la cápsula apila un rótulo sobre dos líneas de estado y es lo
   más alto de la fila cuando crece la tipografía.

Ningún número único para todos los tamaños. Nada se oculta ni se achica por
debajo del tamaño del sistema: la columna de texto se angosta y envuelve.

## 6. Pruebas geométricas

`test/features/map/physical_review_geometry_test.dart` — **31 pruebas** que
miden `Rect` reales en vez de conformarse con «no hubo overflow».

El comparador infla el rectángulo del control por
`Taba2MapGeometry.minSeparation` y falla si toca el contenido, de modo que
verifica intersección **y** separación mínima. Mide contra la **región donde la
superficie puede pintar**, que es exacta a cualquier escala, y sólo compara
contra el texto cuando el texto entra en esa región: un mensaje más largo lo
recorta el scroll, así que su rectángulo de layout no dice nada sobre lo que
el rider ve.

Cubre brújula, recentrar, cápsula, atribución, sheet, mensaje corto y largo,
sheet colapsada y expandida, con y sin mapa, y GPS `none/stale/live`.

**Prueba de base contra `d1ce78e`**, en worktrees desechables creados con
`--detach` y eliminados después:

```
00:03 +8 -23: Some tests failed.
control Rect.fromLTRB(256.0, 212.8, 304.0, 260.8) is within 8.0 dp
  of content Rect.fromLTRB(24.0, …)
```

**23 de 31 fallan sobre `d1ce78e`**, incluida la combinación exacta
fotografiada en el Moto. Sobre el fix pasan 31/31.

## 7. Escalas de texto

Matriz 320 / 390 / 432 dp × 1.0 / 1.3 / 1.5, más 100 % y 150 % en dispositivo.
Cero overflow, cero solape, acceso secundario y CTA siempre dentro del
viewport, con el sheet **colapsado**.

## 8. Varios pedidos — verificado en dispositivo

| Caso | Resultado |
|---|---|
| 1 pedido | Sin badge, sin acceso, sin espacio reservado, dos paradas visibles (`01`) |
| 3 pedidos, 100 % | `+2`, «Ver 2 pedidos más», **ambas paradas**, CTA — todo sobre el pliegue (`02`) |
| 3 pedidos, 150 % | Igual, con la nota de privacidad completa (`06`) |
| 2 pedidos | «Ver 1 pedido más» (singular, probado) |
| 5 pedidos | «Ver 4 pedidos más» (probado) |

La cantidad sale de la lista; no hay ningún `2` escrito a mano.

## 9. Drawer y Entregas

«Ver 2 pedidos más» abre la lista completa con los tres pedidos, cada uno
rotulado `La Taba 2 · Mendoza 827` (`03`), y el gesto Atrás devuelve al mapa
(`04`). Sin el crash de `setState during build`.

## 10. Privacidad

Probado que ni la pantalla ni la capa semántica exponen el domicilio exacto
pre-claim, **ni en el home ni en la lista completa**, con el domicilio presente
en los datos para que la prueba signifique algo. En dispositivo, el pedido
disponible muestra «Zona Confluencia» y la nota «La dirección exacta se muestra
al aceptar» (`06`).

## 11. APK de revisión y hash

| | |
|---|---|
| Package | `com.lataba.rider.review` — «TABA2 Rider · Revisión» |
| SHA-256 final | `a2be1d2dd7487c83aebf1d17096ad25b89c93b2e485b650e2886365eb3ebb11e` |
| Tamaño | 170 984 223 bytes |
| Build intermedio | `e9a78e571d040f6453c81711e0912e9203f87e1fd70c2be11fdb151228ae5daa` |

Sigue sin credenciales: `TABA_SUPABASE_URL`, `TABA_PUBLISHABLE_KEY` y
`TABA_BUSINESS_ID` vacíos; `applicationId` sin cambios; coordenadas nulas.

## 12. Staging antes y después

`d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299` — **idéntico
antes, después de instalar y al cerrar**. `firstInstallTime` 2026-08-02
22:20:15 y `lastUpdateTime` 2026-08-05 03:25:22 sin cambios. `versionCode` 1.
`com.lataba.rider.staging.test` intacto. Sin `pm clear`, sin desinstalar, sin
restaurar, sin migrar sesiones. `font_scale` restaurado a 1.0.

## 13. Capturas

`D:\1212\artifacts\taba2-rider-commercial-redesign\physical-review-p1-fix\`

`01-un-pedido-100` · `02-tres-pedidos-100` · `03-acceso-entregas` ·
`04-retorno-al-mapa` · `05-brujula-100` · `06-brujula-150` ·
`07-sheet-expandida-150` · `08-buscando-pedidos-150`, más `pre-device/` con
diez renders de 320 y 432 dp usados para detectar que P1-2 estaba a medias.

## 14. P0 / P1 / P2

**P0 nuevos:** ninguno.
**P0 encontrado y corregido durante el arreglo:** el `setState during build` al
abrir Entregas, porque bloqueaba la ruta que P1-1 debe hacer visible.

**P1-1 y P1-2: corregidos**, verificados en dispositivo y cubiertos por pruebas
que fallan sobre `d1ce78e`.

**P2 fuera de alcance, verificados como NO tocados:**

| P2 | Verificación |
|---|---|
| Controles de mapa sin efecto cuando no hay mapa | `_buildMapControls` sigue incondicional |
| Franja vacía del sheet expandido | sin cambios |
| Etiqueta «Entrega. Entrega.» | sin cambios |
| Atribución que se despega | `bottom: height + xs` sin cambios |

**P2 nuevos observados, no corregidos:**

- `OrdersPage` empujada desde el home muestra el botón de menú del drawer en su
  AppBar en lugar de una flecha Atrás. El retorno funciona con el gesto del
  sistema y con *Inicio* en el drawer.
- En 320 dp al 150 %, el área libre del mapa queda en ~85 dp y el mensaje de
  reemplazo se ve desplazable, con pocas líneas a la vista. Ya no hay solape
  —que era el P1— pero tampoco entra. No se pierde información: la misma
  advertencia aparece por parada dentro del sheet.
- En 320 y 390 dp, y a 1.3× y 1.5×, la parada de entrega necesita un scroll en
  el sheet colapsado. Ya era así antes de esta rama; el fix garantiza las filas
  fijadas en todas las combinaciones y ambas paradas en el equipo revisado.

## 15. Archivos

`lib/core/theme/taba2_tokens.dart` · `lib/features/map/presentation/rider_map.dart` ·
`lib/features/map/presentation/rider_home_page.dart` ·
`lib/features/map/presentation/widgets/rider_sheet.dart` ·
`lib/features/orders/presentation/orders_page.dart` ·
`test/features/map/physical_review_geometry_test.dart` · 4 goldens.

## 16. Commits

```
9b498db fix(rider-ui): pay for the pinned row instead of charging it to a stop
faee760 fix(rider-ui): reserve the whole map chrome, not just the rail
ca7e600 test(rider-ui): cover physical-review geometry regressions
d20c5b1 fix(rider-ui): prevent map controls from overlapping scaled text
eb3531c fix(rider-ui): surface additional available orders above the fold
```

Son cinco y no tres porque cada pasada de verificación —render previo y luego
el teléfono— mostró que el arreglo anterior estaba incompleto. Sin `amend`.

## 17. Git

Árbol limpio. `flutter analyze` limpio. **247 pruebas Dart verdes.** Tests JVM
`BUILD SUCCESSFUL`. `git diff --check` sin hallazgos. Secret scan sin
coincidencias. Cuatro goldens regenerados tras inspeccionar cada diff: el del
mapa muestra el texto deteniéndose antes del rail, que es la corrección y no su
consolidación.

## 18. Locks

| Lock | Uso | Estado |
|---|---|---|
| `heavy-compute.lock` | Adquirido dos veces, carpeta atómica sin `-Force`, con `owner.txt` | **Liberado** ambas veces |
| `moto-g15.lock` | Toda la fase de dispositivo | **Liberado** |

Al empezar la fase de build, `heavy-compute.lock` estaba tomado por
`TABA2_RETAIL_UNIT_PUBLICATION` con PID vivo durante ~1 h. **No se tocó**: se
esperó. Al cerrar, el lock lo tiene `TABA2_COMMERCIAL_SHELF_STAGE1`, ajeno.

## 19. Declaración

Se cumplen las condiciones de cierre:

| Condición | Estado |
|---|---|
| Los dos P1 corregidos | ✅ |
| «Ver N pedidos más» visible arriba del pliegue | ✅ dispositivo `02`, `06` |
| Múltiples pedidos no quedan escondidos | ✅ badge `+2` y acceso a los tres |
| Brújula y texto no se superponen | ✅ dispositivo `05`, `06` |
| Pruebas geométricas verdes | ✅ 31/31, 23 fallan sobre `d1ce78e` |
| Revisión física real verde | ✅ moto g15, 100 % y 150 % |
| Staging intacto | ✅ hash idéntico antes y después |
| Package aislado | ✅ `com.lataba.rider.review`, sin credenciales |
| Cero P0 nuevos | ✅ |
| Git limpio | ✅ |
| Locks liberados | ✅ |
| Sin push / deploy | ✅ |

**TABA2_RIDER_COMMERCIAL_REDESIGN_PHYSICALLY_REVIEWED**

No se declara listo para producción. Los cuatro P2 originales y los tres nuevos
quedan documentados y sin implementar.
