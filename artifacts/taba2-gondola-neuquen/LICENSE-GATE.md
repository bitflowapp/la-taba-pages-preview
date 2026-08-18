# LICENSE GATE · alcohol

**Veredicto: `alcohol_sales_enabled = false`. Los 23 SKU con alcohol se cargan
verificados y correctamente catalogados, y NO son comprables.**

El titular pidió que, antes de encender la venta de alcohol, se verificara
contra fuente oficial vigente. Se verificó lo que se pudo verificar. Las dos
comprobaciones dieron **no acreditado**, así que la compuerta queda cerrada.

---

## Comprobación 1 · el horario municipal vigente

**No acreditado.** No se pudo confirmar contra fuente oficial que la ventana
09:00–23:00 sea la vigente para Neuquén Capital, ni descartar una modificación
posterior.

Qué se intentó, y con qué resultado:

| fuente | resultado |
|---|---|
| `digesto.muninqn.gov.ar` | el repositorio existe y tiene las ordenanzas por año, pero **no expone un buscador consultable**; las ordenanzas se publican como **PDF escaneados sin capa de texto** (se descargó la 14392: 401 KB de imagen, sin texto legible) |
| `cdnqn.gov.ar` (Concejo Deliberante) | **no responde por HTTPS** (`ECONNREFUSED` en 200.51.92.85:443) |
| `neuquencapital.gov.ar` · boletines oficiales | devuelve boletines completos en PDF, sin índice temático por «bebidas alcohólicas» |
| prensa local | lo que aparece es el **horario de cierre de bares y locales bailables** (5 y 7 de la mañana), que es otra cosa: regula la actividad nocturna, no el expendio minorista |

Lo único firme que apareció sobre venta minorista en Neuquén Capital es una
prohibición: **los kioscos en la vía pública no pueden comercializar ningún tipo
de bebida alcohólica.** No aplica a TABA, que es un local, pero muestra que la
regulación por tipo de comercio existe y es específica.

**No se inventó un horario.** La ventana 09:00–23:00 queda registrada como la
política declarada por el titular en `data/alcohol-policy.json`, con este
pendiente escrito al lado.

Cómo se cierra: pedir a la Dirección de Comercio de la Municipalidad de Neuquén
el número y texto vigente de la ordenanza de expendio, o el certificado de
habilitación que suele transcribir el horario permitido.

---

## Comprobación 2 · la habilitación comercial de La Taba

**No acreditado, y es la que decide.**

No hay ningún registro de habilitación comercial en ninguna parte:

- el esquema de la base **no tiene una sola columna** de licencia, habilitación
  o rubro habilitado (se buscó `license`, `habilitacion`, `permit` en las 110
  migraciones: cero resultados);
- el repositorio no tiene ningún documento, número de expediente ni rubro
  declarado para el local;
- el perfil fiscal existente cubre facturación (ARCA), que es otra cosa: se
  puede facturar una venta que no se está habilitado a hacer.

O sea que **no hay dónde mirar**, ni siquiera para encontrar un «no». Ese es
exactamente el caso que el titular describió: *«Si la habilitación comercial
para alcohol NO está comprobada … reportá LICENSE GATE. No inventes una
habilitación.»*

Cómo se cierra: el certificado de habilitación municipal del local, con el rubro
de venta/expendio de bebidas alcohólicas incluido.

---

## Qué quedó hecho, entonces

| | |
|---|---|
| los 23 SKU con alcohol | **cargados**, `is_verified = true`, en su categoría correcta (Cervezas, Fernet, Aperitivos, Vinos, Destilados), con `is_alcoholic = true` y `minimum_age = 18` |
| comprables | **no**: `available = false` |
| `alcohol_sales_enabled` | **false**, sin tocar |
| dónde se ven | en el catálogo completo, con su precio y su marca +18. **No** aparecen en los carruseles de la home, porque esas secciones filtran por comprable |
| los 29 sin alcohol | comprables y publicados con normalidad |

La compuerta está en el propio lote: `available` se resuelve por fila con
`not e.is_alcoholic`, y encenderla exige dos banderas explícitas —
`--alcohol-comprable` y `--habilitacion-comercial-acreditada`—, más que el
comercio tenga `alcohol_sales_enabled` con su política horaria completa. Sin
las tres cosas, el guion aborta.

---

## Lo que el servidor YA impone, y no hay que construir

Medido el 2026-08-18 sobre `20260812220000_business_operations_checkout_enforcement.sql`,
en las **dos** rutas de creación de pedido (directa y Checkout Pro):

| regla pedida | estado |
|---|---|
| validación server-side, no sólo frontend | **sí**, en la RPC que crea el pedido |
| política completa obligatoria | **sí**: sin `alcohol_sales_enabled`, edad, inicio, fin y huso, aborta con «politica de alcohol no configurada» |
| confirmación 18+ en el checkout | **sí**: sin `age_confirmed` aborta con «confirmacion de mayoria de edad requerida» |
| ventana horaria | **sí**, comparando contra el huso del comercio, y soporta ventanas que cruzan la medianoche |
| que una compra iniciada antes de las 23 no burle el gate | **sí**, y por construcción: usa `clock_timestamp()` —la hora real del momento de la venta— no el inicio de la transacción ni la hora del navegador. Un carrito armado a las 22:59 que confirma a las 23:01 se rechaza |
| el checkout explica por qué | **sí**: el cliente traduce los tres rechazos a castellano de mostrador («fuera del horario permitido», «confirmá que sos mayor de 18», «este comercio todavía no tiene habilitada la venta») |
| edad mínima en el pedido | **sí**: `orders_age_confirmation_complete` exige que la marca de tiempo y la política viajen juntas, con la edad entre 18 y 99 |
| verificación de edad en la entrega · el Rider puede rechazar | **no medido**: vive en la app del Rider, en otro repositorio, y no se tocó en esta misión |

Es decir: **cuando la habilitación se acredite, encender el alcohol es escribir
cinco campos.** Todo lo demás ya está y ya falla cerrado.
