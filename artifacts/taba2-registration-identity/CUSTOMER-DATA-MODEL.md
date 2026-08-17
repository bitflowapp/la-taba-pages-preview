# TABA2 · Memoria del cliente · MODELO DE DATOS

## 0. Hallazgo de la Fase 0: esto ya existía

El track Customer de esta misión **no diseñó tablas nuevas**. La auditoría del
schema 103 encontró que el contrato ya estaba entero desde dos migraciones
anteriores:

| Migración | Qué trajo |
|---|---|
| `20260728090000_customer_profiles_addresses` | `customers`, `customer_addresses`, RLS, el índice único de predeterminada, las cinco RPC y el resolutor de dirección guardada dentro de `create_order_with_items` |
| `20260729150000_customer_profile_completion` | endureció nombre y teléfono, y normalizó el teléfono a dígitos |

Lo que faltaba de verdad —y es lo que agregó esta misión— era **una sola prueba
de base**: 47 pruebas en `supabase/tests/customer_profile_isolation_test.sql`.
Un contrato de aislamiento sin prueba es una promesa.

Crear tablas paralelas habría sido duplicar autoridad. El delta se limitó a
certificar lo que había.

---

## 1. Los campos reales del checkout, clasificados

Salen de los `name=` que el formulario tiene de verdad en `index.html`, no de una
lista imaginada.

### PERSIST SAFE — se guardan en el perfil

| Campo del checkout | Dónde vive | Nota |
|---|---|---|
| `customerName` | `customers.name` | 2–80, con al menos una letra |
| `customerPhone` | `customers.phone` | normalizado a 10–13 dígitos |
| `customerAddressLabel` | `customer_addresses.label` | «Casa», «Trabajo» |
| `customerStreetAddress` | `.street` + `.street_number` | se parte al guardar |
| `customerNeighborhood` | `.city` | localidad |
| `customerAddressNeighborhood` | `.neighborhood` (declarado) | agregado en `20260812240000` |
| `customerAddressFloor` | `.floor` | |
| `customerAddressApartment` | `.apartment` | |
| `customerReference` | `.reference` | «portón negro», «timbre roto» |
| `customerAddressProvince` | `.province` | |
| `customerAddressPostalCode` | `.postal_code` | |
| `deliveryLatitude`/`Longitude` | `.latitude`/`.longitude` | sólo si la persona **confirmó** la ubicación |
| `deliveryGeolocationAccuracy` | `.geolocation_accuracy` | |
| `deliveryAddressSource` | `.source` | `manual` \| `gps` \| `geocoder` \| `previous_order` |
| `customerAddressDefault` | `.is_default` | máximo una por persona |

No se agregó **ni un campo de geodata nuevo**: los tres de ubicación ya los
produce el paso de confirmación que existía.

### SESSION ONLY — viven en el pedido, no en el perfil

| Campo | Por qué no se guarda |
|---|---|
| `customerNotes` | son notas **de ese pedido** («dejalo con el encargado»), no un rasgo de la persona |
| `deliveryMode` | se elige por pedido |
| `paymentMethod` | se elige por pedido |
| `deliveryLocationConfirmedAt` | es el instante de una confirmación puntual |
| `customerAddressId` | referencia, no dato |

### NEVER STORE — verificado, no sólo declarado

| Dato | Estado en la base |
|---|---|
| número de tarjeta, CVV | **no existe ninguna columna**; el pago va por Checkout Pro de Mercado Pago y TABA nunca ve la tarjeta |
| token de pago reutilizable | no existe |
| credenciales de Mercado Pago del cliente | no existen |
| contraseñas | viven en `auth.users` de GoTrue, cifradas por él; ninguna tabla de TABA las toca |
| OTP | no existe |
| **PIN de entrega** | existe en `order_delivery_handoffs`, **no** en el perfil: es un secreto por pedido, guardado como `code_hash` + `code_ciphertext`, y el Rider sólo puede enviar un candidato |

El PIN merece el subrayado: no está en el perfil del cliente y no es reutilizable
entre pedidos. Un PIN persistente sería un secreto de larga vida para abrir
puertas ajenas.

---

## 2. La identidad es `auth.uid()`, y no se puede elegir

```sql
create table public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  ...
);
```

La clave primaria **es** el uid. No hay una columna `user_id` junto a un `id`
propio: no hay dos formas de decir quién es el dueño, así que no hay forma de que
discrepen.

Las cinco RPC derivan `v_customer_id := auth.uid()` y **ninguna acepta un
identificador de persona en su firma**:

| RPC | Firma |
|---|---|
| `get_current_customer_profile` | `()` |
| `upsert_current_customer_profile` | `(p_name text, p_phone text)` |
| `upsert_current_customer_address` | `(p_address jsonb)` |
| `set_current_customer_default_address` | `(p_address_id uuid)` |
| `archive_current_customer_address` | `(p_address_id uuid)` |

Las dos que reciben un id de dirección lo buscan con
`where a.id = ... and a.customer_id = auth.uid()`: el id ajeno se comporta
exactamente como un id inexistente.

Control negativo #3 de esta misión: se reescribió la RPC para que un encabezado
del cliente pudiera ganarle a `auth.uid()`, y la suite pasó de PASS a FAIL.

---

## 3. Una sola dirección predeterminada, y es de la tabla

```sql
create unique index customer_addresses_one_default_idx
on public.customer_addresses(customer_id)
where is_default and deleted_at is null;
```

La prueba que importa no pregunta si la RPC se porta bien: fuerza el estado
prohibido con un `UPDATE` directo, como superusuario, saltándose toda la lógica.
La base contesta `23505`.

Eso es lo que hace que la invariante no dependa de que el navegador desmarque la
anterior, ni de que dos pestañas se pongan de acuerdo.

Control negativo #4: se dejó caer el índice, y la suite pasó a FAIL.

### Qué pasa al borrar la predeterminada

`archive_current_customer_address` marca `deleted_at`, apaga `is_default`, y
**muda la predeterminada** a la dirección viva más recientemente usada. Nunca
queda una persona con direcciones y ninguna predeterminada.

El borrado es lógico, no físico, a propósito: los pedidos viejos guardan su
**propia** copia inmutable de la dirección (`orders.delivery_*`), así que borrar
una dirección no reescribe la historia de ninguna entrega.

---

## 4. La sesión anónima es una identidad como cualquier otra

El cliente que compra entra con `signInAnonymously` de GoTrue. A los efectos de
esta memoria eso **no es un caso especial**: tiene un `auth.uid()`, tiene su
perfil, y no ve el de nadie. Probado en la suite (sección 10) y contra producción
real en el smoke.

Lo que sí es especial es lo contrario: `identity_is_anonymous()` hace que una
sesión anónima **nunca** sea equipo, ni pueda pedir acceso al Panel. Un cliente
curioso con el anon key no puede convertirse en solicitante.

Si la persona pierde esa identidad —limpia el navegador, cambia de teléfono— la
memoria se pierde con ella. **No se finge recuperación cross-device**: no hay
fingerprinting, no se usa IP ni identificador de aparato. Recuperarla exigiría
vincular la identidad anónima a un correo, y eso es la Fase 9, que queda
documentada como evolución y no implementada.

---

## 5. La precarga, y la carrera que no puede perder

`js/core/customer-delivery-address-hydration.js` resuelve una sola pregunta: si
la respuesta del perfil llega **después** de que la persona empezó a escribir,
¿qué gana?

| Situación | Decisión |
|---|---|
| la dirección elegida ya no existe | aplicar la predeterminada |
| viene de la predeterminada y el formulario está intacto | aplicar la predeterminada |
| la persona eligió una guardada, sin tocar nada, sin interactuar mientras cargaba | reaplicar su elección |
| **cualquier otra cosa** | `PRESERVE`: no se toca lo que hay |

`addressFormDirty` y `userInteractedWhileLoading` son las dos señales que hacen
que un `fetch` lento no pueda borrar lo que alguien está tipeando.
`profileHydrationVersion` descarta respuestas de una carga anterior.

Y el guardado es un acto, no una tecla: `persistAddress` corre al confirmar, no
en cada `input`.

### Pedido y perfil son responsabilidades distintas

Si guardar el perfil falla, el checkout **no** se cae: `create_order_with_items`
acepta los datos escritos a mano igual que una dirección guardada. Perder un
pedido porque no se pudo guardar una libreta de direcciones sería el peor cambio
posible.
