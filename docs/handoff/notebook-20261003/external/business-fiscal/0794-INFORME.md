# El Panel de recuperación, publicado y certificado en staging

**2026-08-10 · `https://taba2-staging.pages.dev` · deployment `0dc54b0f`**

Declaración: **`TABA2_ORDER_RECOVERY_PANEL_CERTIFIED_ON_STAGING`**

El operador ya puede armar, desde el Panel publicado, el pedido de un cobro que
entró y se quedó sin reserva. Y cuando el stock no alcanza, el Panel le dice
exactamente qué falta en vez de inventar un pedido incumplible.

---

## 1. El defecto que había que corregir antes de publicar

**La rama dibujaba el botón y nadie lo escuchaba.**

`paymentActionsFor` agrega la acción `recover-order`, y
`business-panel-render.js` la renderiza genéricamente como
`data-payment-action="recover-order"`. Pero el despachador
`runPaymentAction` (`business-operations-center.js`) sólo tenía ramas para
`refund`, `diagnostic` y `refresh`: **todo lo demás caía en el reconcile del
final**. El operador tocaba «Armar el pedido de este cobro» y el sistema le
preguntaba a Mercado Pago, con un mensaje que decía otra cosa. El pedido no se
armaba.

Publicar `59d8e03` tal cual habría puesto en staging un botón que miente —
peor que no tenerlo. Se agregó la rama que faltaba, el cableado del contexto
(`recoverPaidCheckoutOrder`) y el fallback del contexto por defecto.

**Deuda que queda anotada, no maquillada:** el handler de
`production-operations.js` para `[data-production-payment-recover]` (32 líneas
que vienen de la rama) **sigue siendo inalcanzable**: ningún render emite ese
atributo, porque `paymentRecoveryActions` nunca devuelve `kind: 'recover'`. Se
publicó tal como vino. No inventé el render que falta.

---

## 2. Integración semántica, no reemplazo

**100 líneas agregadas, CERO eliminadas**, en 4 archivos, sobre `c9b9f0d` — lo
que staging servía.

| Archivo | Base desplegada | Cómo se integró |
|---|---|---|
| `business-payments-console.js` | idéntica a la de la rama | hunk directo (+10) |
| `production-operations.js` | idéntica a la de la rama | hunk directo (+32) y +1 de cableado |
| `supabase_order_repository.js` | **distinta** | `--3way` sobre la desplegada (+35) |
| `business-operations-center.js` | — | +22, el arreglo del despachador |

El tercero es el que importaba. La versión que sirve staging es la de `da56ce9`
(`374e910`); la base de la rama es otra (`3c30ec1`, con la performance de
digital-commerce-100, que **no** está desplegada). Copiar el archivo entero
desde `59d8e03` habría arrastrado cambios ajenos a este encargo. El hunk entró
con `--3way` sobre la versión viva.

**Verificado después del deploy:** los 4 archivos servidos coinciden byte a byte
con el commit `0efe1dc`.

---

## 3. Lo que NO se tocó

- **`sw.js` intacto** (`la-taba-runtime-v56-seguimiento-en-vivo`). El `fetch` del
  service worker es **network-first**: pide a la red y sólo cae al caché si
  falla, así que los módulos nuevos llegan solos. Rotar la caché habría tirado la
  de todos los clientes sin ninguna necesidad, y además pisaba la decisión
  deliberada de la sesión de tracking de no bumpear dos veces.
- **`runtime-config.js` preservado byte a byte** (`sha256 57d8a007…`): bajado del
  vivo antes de subir y comparado después. Sigue apuntando a `ukxqbgswjlibmnjemrzd`.
- **`app.js`, `ui.js`, `index.html` y el resto del tracking v56**: sin cambios,
  verificado por hash contra lo que estaba antes.
- **`catalog/` y `data/`**: no se publican (devuelven el fallback HTML), y se
  respetó. Por eso el set de subida es 352 y no 373.

---

## 4. Certificación en la URL pública — 12/12

| Contrato | Resultado |
|---|---|
| Panel abre normalmente | ✅ con la cuenta owner |
| Pedidos existentes visibles | ✅ LT-0118 en la bandeja |
| Recovery aparece sólo cuando corresponde | ✅ **2 botones sobre 85 tarjetas de pago** |
| No duplica el pedido | ✅ 97 → 98 y el botón **desaparece** tras armarlo |
| Stock insuficiente muestra faltantes | ✅ «No hay stock para armarlo: QA recovery panel (hay 69, hacen falta 900). Devolvé el dinero desde el Panel.» |
| Y no inventa un pedido incumplible | ✅ el caso B no creó nada |
| Polling/realtime siguen funcionando | ✅ la consulta de respaldo siguió corriendo |
| Cero errores de consola | ✅ |
| Cero 4xx/5xx del sitio | ✅ |

### Permisos, en las tres identidades

- **owner** → `can_recover_order = 1`, ve la acción.
- **miembro no elevado (rider)** → `42501 «pagos no autorizados»`: no puede ni
  listar pagos.
- **cliente anónimo** → `401 / 42501 permission denied` en
  `recover_paid_checkout_order` y `list_business_payments`.

Ningún control QA queda expuesto al cliente: la acción vive detrás del login del
Panel y el servidor la niega por rol, no sólo la UI.

### `security_review_required`

Los dos cobros de prueba estaban justamente en ese estado y el Panel sólo ofreció
las transiciones permitidas: armar el pedido (cuando el backend lo habilita) y
devolver el dinero. La salida del estado la certificó la migración
`20260809220000` en el encargo anterior.

---

## 5. Gates

- `npm run check` verde.
- `npm test` **1240/1240**, re-corrido **después** del cableado, no sólo antes.
- Playwright focal sobre la URL pública: **12/12**.
- Sin migraciones. Sin redeploy del worker. Sin producción. Sin push.

---

## 6. Fixtures y estado final

Se crearon **2 cobros QA** marcados `qa-recovery-%` en el negocio real (uno con
stock suficiente, otro pidiendo 900 unidades) y se **borraron** al terminar,
junto con el pedido que generó el caso A y su reserva.

| | antes | después |
|---|---|---|
| pedidos | 97 | **97** |
| stock góndola | 760 (Speed 70) | **760 (Speed 70)** |
| reservas activas | 0 | **0** |
| checkout_sessions | 83 | **83** |
| outbox `dead_letter` | 0 | **0** |
| LT-0030 | `arrived` $550 | **idéntico** |
| ARCA | 0/0 | **0/0** |

Ni un pedido ni un stock humano tocado.

---

## 7. Una desviación de protocolo, dicha por mí

Verifiqué el lock `taba2-staging-mutation.lock` **libre** a las 06:07Z, como
pedía el encargo, pero **no lo tomé antes de trabajar**: lo escribí recién al
cerrar, a las 06:28Z. La convención de esa carpeta es tomarlo *antes* de mutar.
Al escribirlo lo releí y seguía con mi cierre anterior, así que no hubo carrera
ni nadie quedó pisado — pero la ventana existió y queda registrada.

---

## Evidencia

`cert-panel.json` (los 12 pasos) · `cert-01-pagos.png` (la vista de Pagos con el
botón) · `cert-02-armado.png` (el pedido armado) · `cert-03-sin-stock.png` (el
mensaje con lo que falta).
