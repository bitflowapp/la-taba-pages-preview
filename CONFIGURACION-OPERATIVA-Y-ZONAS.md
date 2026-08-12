# LA TABA2 — configuración operativa real y zonas de delivery

**Nada de esto está aplicado.** Ni a staging, ni a producción —que no existe—.
El árbol tiene cinco migraciones nuevas, un seed que `db push` no mira, y los
gates corridos contra un PostgreSQL propio y descartable creado **vacío**.

---

## 1 · Qué faltaba, en una línea

El esquema no tenía dónde poner el horario de atención ni la cobertura de
delivery. **No es que nadie los cargó: no existía la columna.** El comercio
abría cuando `ordering_enabled` estaba en `true`, y entregaba en cualquier lado
con una tarifa única.

---

## 2 · Arquitectura final

### Las tablas

| Tabla | Qué guarda |
|---|---|
| `business_service_hours` | una fila por (canal, día, franja). Turno partido sin tocar el esquema |
| `business_service_exceptions` | feriados, cortes y horarios especiales, por fecha |
| `delivery_zones` | la **lista blanca** de cobertura, con envío y mínimo por zona |
| `business_config_audit` | quién cambió qué, cuándo, con el estado completo antes y después |

Y en `businesses`: `operating_timezone`, `hours_enforced`,
`delivery_zone_enforced`, `alcohol_hours_enforced`, `delivery_max_radius_meters`.
En `business_members`: `can_manage_commercial_settings`.

### Las cuatro decisiones

**1 · Horarios en tabla, no en columnas.** Un `opens_at`/`closes_at` en
`businesses` no representa un sábado distinto ni un corte al mediodía. Una fila
por franja sí, y admite 08:00–14:00 + 17:30–22:30 sin cambiar nada.

**2 · La cobertura es una lista, no un radio.** Un radio desde Mendoza 827 cruza
el río y mete Cipolletti adentro. Hay **dos formas de estar adentro**, las dos
son lista blanca:

- `polygon` — el punto confirmado cae dentro de un borde cargado (`boundary @> point(lng, lat)`, tipo nativo de PostgreSQL, sin extensiones).
- `declared_area` — el barrio que la persona eligió **de la lista que publica el propio comercio** coincide con una zona activa.

Cuando las dos aplican, **gana el polígono**: una frontera cargada pesa más que
lo que alguien eligió de un desplegable.

`delivery_max_radius_meters` existe, pero **sólo puede negar**. Es un tope duro
opcional que descarta un punto absurdo. Ningún camino del código concede
cobertura por distancia. Y no se puede encender contra un pin que nadie
confirmó: `set_delivery_pricing` lo rechaza si el punto del local no está
`human_verified`, que hoy **no lo está**.

**3 · Envío y mínimo pueden variar por zona**, con caída al valor del negocio
cuando la zona no define el suyo. Un mínimo `NULL` es «sin mínimo» —una decisión
legítima— y no una configuración incompleta.

**4 · Nada cambia hasta que alguien lo encienda.** `hours_enforced` y
`delivery_zone_enforced` arrancan en `false`. **El día que se aplique la
migración, el comportamiento es idéntico al de hoy.** Apagar la bandera revierte
sin desplegar nada.

### Quién escribe

**Nadie escribe estas tablas directamente.** No hay grant de
`insert`/`update`/`delete` para `authenticated`. El único camino son las RPC del
Panel, que **autorizan, validan y auditan en la misma transacción**. RLS deja
leer a quien pertenece al comercio; el cliente no lee nada de acá, pregunta por
RPC.

---

## 3 · Migraciones

Cinco, reproducibles desde una base vacía. El total pasa de 73 a 78.

| Archivo | Qué trae |
|---|---|
| `20260812100000_business_operations_hours_and_delivery_zones.sql` | las cuatro tablas, las banderas, RLS, el trigger de auditoría y la compuerta de delegación |
| `20260812110000_business_operations_resolution.sql` | `business_is_open`, `business_next_open_at`, `resolve_delivery_zone`, `commerce_availability` |
| `20260812120000_business_operations_checkout_enforcement.sql` | los dos caminos de alta preguntan horario y cobertura |
| `20260812130000_business_operations_panel_rpcs.sql` | las diez RPC del Panel |
| `20260812140000_customer_address_declared_neighborhood.sql` | el barrio declarado viaja con la dirección |

**Seguridad de la migración:** todas las columnas nuevas son nullable o traen un
default que preserva el comportamiento de hoy; las tablas nuevas arrancan
vacías; con las banderas apagadas no se consultan; y el constraint
`businesses_hours_need_timezone` impide el estado incoherente de exigir horarios
sin decir en qué huso.

---

## 4 · Las funciones que deciden

### `business_is_open(business, canal, instante) → boolean`

Fuente única de verdad del horario. Con la exigencia apagada devuelve `true`;
encendida sin huso configurado, `false` —falla cerrado—.

**El cruce de medianoche, bien hecho.** Una franja 22:00–02:00 del lunes termina
el **martes** a las 02:00. Preguntar «¿la franja de hoy contiene esta hora?»
daría dos respuestas equivocadas a la vez. Por eso el día de hoy aporta sólo su
**cola** cuando cruza, y el arrastre de la 01:00 lo aporta el día **anterior**.
Los cuatro casos tienen ensayo, incluido el que casi nadie prueba: el martes a
la 01:00 con la franja cargada **el martes** está CERRADO, porque esa franja
todavía no empezó.

Un cierre explícito por excepción cierra **toda la fecha local**, incluido el
arrastre del día anterior. Es la lectura conservadora, y es la que una persona
espera de un feriado.

### `resolve_delivery_zone(business, lat, lng, barrio) → jsonb`

Devuelve **siempre** un objeto, nunca `NULL`: «no llegamos» es una respuesta, no
la ausencia de una. Trae `eligible`, `zone_id`, `zone_name`, `match_kind`,
`delivery_fee`, `minimum_subtotal` y un `detail` con el motivo exacto.

**No está al alcance del navegador.** Ni `anon` ni `authenticated` pueden
ejecutarla.

### `commerce_availability(business, canal, contexto) → jsonb`

La del cliente, y la única pública. Contesta abierto/cerrado, próxima apertura,
horarios publicados, barrios elegibles, y si llegamos con qué envío y qué mínimo.

**Todos los motivos de no-cobertura salen colapsados en uno**, con la misma
frase: *«Por el momento no realizamos entregas en esta zona.»* La respuesta no
distingue «tu barrio no está en la lista» de «estás más lejos que el tope»: si
lo hiciera, se podría reconstruir el mapa de la cobertura preguntando. El
contexto acepta exactamente tres claves —`latitude`, `longitude`,
`neighborhood`—; cualquier otra, incluida una tarifa, se rechaza.

---

## 5 · Dónde se impone

En los **dos** caminos que crean un pedido, en el mismo punto donde ya se
rechazaba por mínimo:

- `create_order_with_items_core` — pedido directo (efectivo).
- `create_checkout_session` — pago online, **antes** de dejar la sesión pagable.

En `finalize_paid_checkout_session` **no se comprueba nada de esto**, y hay un
ensayo que lo verifica leyendo el código de la función: esa rutina corre después
de que el dinero se movió, y un `raise` ahí sería pago tomado con transacción
revertida en loop.

**El navegador nunca mandó un peso y sigue sin mandarlo.** `delivery_fee` no
está entre las claves aceptadas de ninguno de los dos contratos. Lo que cambió
es de dónde sale el número.

La cobertura se resuelve con el **mismo punto confirmado que se entrega** —el
que ya pasó la compuerta `DELIVERY_LOCATION_REQUIRED`—, no releyendo la
dirección guardada, que para entonces pudo cambiar.

El pedido nace con `delivery_zone_id`, `delivery_zone_name` y
`delivery_area_declared` congelados: dentro de un año se puede contestar «¿con
qué zona y con qué envío se tomó?» aunque la zona ya no exista.

---

## 6 · RLS y permisos

| Objeto | anon | authenticated |
|---|---|---|
| `business_service_hours`, `business_service_exceptions`, `delivery_zones` | nada | `select` si pertenece al comercio (owner/admin/staff) |
| `business_config_audit` | nada | `select` sólo si puede cambiar la configuración |
| `resolve_delivery_zone`, `business_is_open`, `business_next_open_at`, `business_day_windows` | **no** | **no** |
| `commerce_availability` | sí | sí |
| las diez RPC del Panel | no | sí, y cada una autoriza adentro |

**Autoridad comercial:** `can_manage_commercial_settings(business)` = owner,
admin, **o** un miembro activo con la delegación explícita encendida. Devuelve
`false`, **nunca `NULL`** —una función de autorización que puede contestar `NULL`
falla ABIERTA en la forma `if not autorizado then raise`, porque `not null` no
es verdadero y la excepción no se levanta—.

**Un staff no se auto-delega.** La bandera se puede escribir por el mismo camino
que el resto de la membresía, así que en vez de recortar grants ajenos hay un
trigger en `business_members`: encender o apagar la delegación exige owner o
admin, y queda auditado venga de donde venga.

**La auditoría no se puede esquivar.** El trigger vive en `businesses`, no en la
RPC: cambiar el costo de envío con un `UPDATE` suelto deja rastro igual. Hay un
ensayo dedicado a eso.

---

## 7 · Panel

Pantalla nueva **«Horarios y cobertura»**, con: grilla semanal de tramos, lista
de zonas con su envío y su mínimo, envío y mínimo del comercio, las banderas de
exigencia y el registro de cambios.

La ve **todo el equipo** —igual que la deja ver la RPC—, pero **editar lo decide
el servidor**: si `can_manage` no viene en `true`, todo va deshabilitado aunque
el rol parezca suficiente. Si la vista se atara al rol del panel, la delegación
a un staff no tendría dónde ejercerse.

**Dos negativas que evitan un apagón:** no se puede exigir horarios sin una sola
franja cargada —sería declarar el comercio cerrado para siempre con un clic— ni
exigir cobertura sin una zona activa —sería cancelar todos los envíos—. Las dos
se contestan diciendo qué falta.

---

## 8 · Cliente

`commerce_availability` se consulta al cargar la tienda y **cada vez que cambia
la dirección activa**. La tarifa que se muestra es la que resolvió el backend,
no la columna del comercio: anunciar un precio y cobrar otro es exactamente lo
que este cambio existe para impedir.

**Cuando el servidor no contestó, la tienda no afirma nada y no bloquea.** El
cliente nunca habilita una compra: la habilita el backend, que rechaza igual.
Bloquear por desconocimiento rompería la tienda cada vez que se cae una consulta
sin ganar una sola garantía.

**Cuando el servidor sí dijo que no, se frena el paso siguiente y se explica por
qué. El carrito no se toca**: lo que la persona eligió sigue ahí, y con retiro en
el local o con otra dirección vuelve a avanzar. Hay un ensayo que verifica las
tres cosas juntas.

El barrio **no es texto libre**: sale de la lista que publica el propio comercio.
Si el comercio no exige cobertura, la lista viene vacía y el campo no aparece.

---

## 9 · Alcohol

No se diseñó ninguna política legal, y no se inventó ningún requisito.

Lo que quedó preparado: `products.is_alcoholic` ya existía; el canal `alcohol`
se admite en las dos tablas de horarios; y la bandera `alcohol_hours_enforced`
—apagada— conecta ese canal al checkout. Con la bandera en `false` no exige
nada. El día que haya una regla, es **dato**, no esquema.

La ventana histórica de alcohol (`alcohol_sales_start`/`_end`, con `between` en
los dos extremos) **no se tocó**: es otro contrato y mezclarlos cambiaría el
comportamiento vigente.

---

## 10 · Tests

**128 afirmaciones contra PostgreSQL real, sobre una base creada vacía** a la que
se le aplican las 78 migraciones. Eso prueba dos cosas a la vez: que el contrato
se cumple, y que PROD puede arrancar sin copiar un byte de staging.

```
TABA_LOCAL_BUSINESS_OPS_DB=1 node scripts/run-business-operations-db.mjs
→ 128 assertions, 78 migrations, 53 s
```

- **107 pgTAP** (`supabase/tests/business_operations_delivery_test.sql`): abierto/cerrado, dos franjas, medianoche en sus cuatro casos, zona habilitada y deshabilitada, tarifa de zona vs. tarifa del comercio, mínimo, manipulación de fee desde el cliente, escalada de rol, RLS, cambio de configuración, dirección fuera de cobertura, tope de distancia que sólo niega, y la auditoría con actor.
- **21 sobre la cadena real** (`business_operations_order_chain.local.sql`): sesiones de checkout de verdad y un pedido de verdad. Fuera de la lista blanca **no se crea sesión y no se reserva stock**; por debajo del mínimo de la zona tampoco; con el comercio cerrado tampoco; y el pedido que sí nace congela la zona.

**Web: 1360/1360**, 19 de ellos nuevos
(`tests/business-operations-delivery.test.mjs`).

Otros gates: `npm run check` verde · `migrations:validate` verde ·
`secrets:scan` limpio.

---

## 11 · Decisiones humanas pendientes

Ninguna de estas se inventó, y el modelo funciona con todas vacías.

| Falta | Qué bloquea |
|---|---|
| **La tarifa definitiva: $2.500 o $3.000** | Un rango no es un precio. Las zonas quedan con `delivery_fee = NULL`, y una zona sin tarifa **no da cobertura**: `resolve_delivery_zone` la niega en vez de entregar gratis por omisión. **Sin esto, la cobertura no se puede exigir.** |
| **El pedido mínimo** | `NULL` significa «sin mínimo», que es una decisión válida. Hoy nadie la tomó. |
| **WhatsApp comercial** | Fuera del alcance de este encargo; sigue en `NULL`. |
| **Pedidos grandes** | No hay regla y no se inventó ninguna. |
| **Días y horarios especiales** | El horario semanal se carga parejo porque es lo único informado. Las excepciones se cargan por el Panel cuando existan. |
| **El pin exacto del local** | El punto sigue `human_verified = false`. Por eso el tope de distancia **no se puede encender**, y el seed no lo intenta. |
| **Los cinco barrios a evaluar** | Mariano Moreno, Provincias Unidas, Alta Barda, 14 de Octubre / COPOL y Rincón de Emilio quedan cargados y **apagados**. Encenderlos es un clic. |

### Un riesgo que conviene decir en voz alta

Con los diez barrios como `declared_area`, **la cobertura descansa en lo que la
persona declara**. Alguien en Cipolletti puede elegir «Santa Genoveva» y el
sistema no tiene hoy cómo desmentirlo: el punto confirmado existe, pero no hay
frontera contra la cual compararlo.

Las dos salidas están construidas y ninguna se activó sola:

1. **Cargar polígonos** para los barrios. Pasan a pesar más que la declaración
   automáticamente, sin tocar el esquema. Dibujarlos acá habría sido inventar
   una medición.
2. **Encender el tope de distancia**, que descarta lo grosero. Necesita antes la
   confirmación humana del pin del local.

---

## 12 · Procedimiento exacto para aplicar en staging

**Nada de esto se hizo.** Requiere autorización explícita.

```bash
# 0 · tomar el lock exclusivo, y no antes
#     D:\1212\_claude-locks\taba2-staging-mutation.lock

# 1 · el worktree necesita el ref: el CLI 2.110 mira este archivo
echo ukxqbgswjlibmnjemrzd > supabase/.temp/project-ref

# 2 · medir el ledger ANTES de empujar nada
C:/1212/scripts/supabase.exe migration list --linked

# 3 · empujar. Las cinco migraciones son aditivas y las banderas arrancan
#     apagadas: aplicarlas NO cambia el comportamiento de staging.
C:/1212/scripts/supabase.exe db push

# 4 · verificar que el ledger quedó en 78 y que db push dice "up to date"
C:/1212/scripts/supabase.exe migration list --linked
```

**Advertencia del ledger:** el remoto y el árbol no coinciden en la punta —hay
migraciones de otras ramas que `db push` aplicaría de arrastre—. Antes de
empujar hay que comparar `migration list --linked` contra
`ls supabase/migrations/` y decidir explícitamente qué entra.

**Después de las migraciones, y sólo entonces:**

```bash
# 5 · el seed comercial, con el business_id real. NO es una migración y
#     `db push` no lo mira.
psql "$DATABASE_URL" \
  -v business_id=<uuid del comercio> \
  -f supabase/seeds/la-taba2-configuracion-comercial.propuesta.sql

# 6 · el cliente. Va DESPUÉS de las migraciones: el checkout manda la clave
#     `neighborhood`, que la base tiene que conocer antes.
npx wrangler pages deploy <dir> --project-name=taba2-staging --branch=staging
```

**Encender la exigencia es un acto humano aparte, en el Panel, y recién cuando
la tarifa esté cargada.** Hasta entonces el comercio se comporta exactamente
como hoy.

---

## 13 · Lo que no se tocó

staging · producción (no existe, y este encargo no la crea) · LT-0142 ·
migraciones existentes · Mercado Pago real · ARCA · WhatsApp · el catálogo ·
la ventana histórica de alcohol · ninguna cuenta existente.

Sin `push`, sin `deploy`, sin `db push`.
