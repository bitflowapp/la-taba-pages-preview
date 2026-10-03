# Gates de la recertificación sobre `8028dcc`

Worktree: `D:\1212\la-taba-business-synthetic-recertification`
Rama: `test/taba2-business-synthetic-recertification-8028dcc`

| Gate | Resultado | Detalle |
|---|---|---|
| `npm run check` | PASS | Sintaxis, activos estáticos e higiene de release |
| `npm test` | PASS | 914 pruebas |
| `npm run fiscal:test` | PASS | 22 pruebas del puente ARCA |
| Tests de pagos | PASS | 25 |
| Tests de scanner / POS / packing | PASS | 35 |
| Tests de permisos | PASS | 19 |
| Tests de apertura / cierre | PASS | 18 |
| Tests de dispositivos | PASS | 11 |
| `tests/business-panel-styles.test.mjs` | PASS | 3 |
| Regresión visual responsive | PASS | 5/5 anchos (320, 360, 390, 412, 432) |
| Escenarios sintéticos | PASS | 82/82 invariantes |
| Rust / Tauri | PASS | 17 |
| Chromium completo | **INCONCLUSO** | Mejor corrida 155/157; fallos ambientales que cambian de corrida en corrida. Ver abajo |
| `git diff --check` | PASS | Limpio |
| Secret scan | PASS | Sin credenciales ni claves privadas |
| PostgreSQL local aislado | **FALLA** | Ver `hallazgo-postgresql.md` |

## Chromium: inconcluso por presión de memoria

El gate no se pudo completar limpio en esta máquina durante esta sesión. Tres corridas, con
resultados distintos entre sí:

| Corrida | Condición | Resultado | Specs que fallaron |
|---|---|---|---|
| 1 | con el build de Rust compitiendo | 153/157 | `approved-beverage-demo` ×3, `operational-hardening` ×1 |
| 2 | subconjunto aislado | 0/6 | los mismos, con `browserContext.newPage: Test ended` |
| 3 | máquina más descargada | **155/157** | `beverage-storefront` ×1, `showcase` ×1 |

**El conjunto que falla cambia en cada corrida.** Eso es inestabilidad del entorno, no un
defecto determinista: una regresión real fallaría siempre en el mismo lugar.

En las tres corridas, **ningún spec del panel ni de la regresión visual falló**.

La confirmación definitiva es una comparación directa: el mismo spec, corrido aislado sobre el
worktree de `1118e73` — el HEAD que hace unas horas cerró 152/152 limpio en esta misma máquina —
**falla exactamente igual ahora**:

```
✘ un GPS local sandbox se presenta en mapa sin inventar ETA
  expect(locator).toHaveCount(1) → Received: 0     (.lt-place-marker.is-store)
```

Es decir: el mismo código que pasó antes ya no pasa, sin que el código haya cambiado. Lo que
cambió es la máquina.

Causa: memoria. Durante la corrida quedaban ~2,7 GB libres de 16 GB, con el stack local de
Supabase (12 contenedores sobre WSL2), Docker Desktop y el navegador del usuario residentes.
Los specs que caen son los que dependen de WebGL para dibujar el mapa y de cargar el catálogo
demo completo; con memoria justa, los marcadores no llegan a renderizarse. Un síntoma anterior
del mismo problema fue más explícito: `browserContext.newPage: Test ended` — el navegador ni
siquiera podía abrir una pestaña.

Lo relevante para este cambio sí está verificado:

- los tres specs del panel (`business-windows-operations`) pasan;
- los cinco specs de regresión visual pasan en los cinco anchos;
- ningún spec que toque `.device-row header`, `.opening-check header` ni los botones de
  confirmación falla.

**No se declara PASS de este gate.** Queda para volver a correr con la máquina descargada.

## PostgreSQL: cambió de NOT_RUN a FALLA

En `1118e73` este gate quedó `NOT_RUN` (Docker apagado, disco lleno). Esta vez Docker levantó,
el stack local arrancó con el contenedor que el runner espera y el gate corrió por primera vez.

Falla, por una restricción introducida en `d1ddec6` que ningún gate anterior podía ver. El
detalle completo, con reproducción y alcance, está en `hallazgo-postgresql.md`.

No lo introdujo `8028dcc`.

## Limpieza de la sesión

- Stack local de Supabase detenido; cero contenedores corriendo.
- Docker Desktop devuelto al estado en que estaba antes (se había levantado sólo para este gate).
- Cero servidores de prueba escuchando en los puertos usados.
- Quedan seis procesos `WebKitNetworkProcess` huérfanos de sesiones anteriores que no
  respondieron al cierre; no ocupan puertos ni afectan al repositorio.
