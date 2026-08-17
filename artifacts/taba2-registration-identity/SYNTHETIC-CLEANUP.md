# TABA2 · Identidades QA sintéticas · EVIDENCIA DE LIMPIEZA

Destino: `la-taba-production` (`wwcpogltfgzgkrlilbcd`).
Herramienta: `scripts/live-registration-smoke.mjs`.

## 1. Qué se creó, y con qué reglas

Cada corrida crea **cinco** identidades:

| Rol QA | Correo | Cómo |
|---|---|---|
| owner sintético | `taba2qa<n>-owner@example.com` | Auth admin, correo confirmado |
| solicitante de Panel | `taba2qa<n>-panel@example.com` | Auth admin, correo confirmado |
| solicitante de Rider | `taba2qa<n>-rider@example.com` | Auth admin, correo confirmado |
| cliente A | (anónima) | `signInAnonymously` real |
| cliente B | (anónima) | `signInAnonymously` real |

Reglas que se respetaron:

* **Ningún correo real.** Todos en `example.com`, que la RFC 2606 reserva para
  documentación y que no tiene buzones. (`.invalid` sería más explícito, pero el
  validador de GoTrue lo rechaza antes de crear nada.)
* **Ningún pedido, ningún pago, ningún producto.** El circuito no toca `orders`
  ni `payment_intents` ni `products`. `ordering_enabled` siguió en `false` todo el
  tiempo.
* **El owner QA se preparó con la credencial de servicio**, que es la vía que el
  guard de membresías tiene explícitamente habilitada para el arranque de un
  entorno. Es la misma que usa `bootstrap-first-business-owner.mjs`.

## 2. Corridas

Fueron **tres** corridas con escritura. Las dos primeras dejaron residuo porque
encontraron sendos defectos en el borrado; las dos veces se limpió a mano, y los
dos defectos se arreglaron con migración antes de seguir.

| Corrida | Etiqueta | Contratos | Limpieza automática | Qué encontró |
|---|---|---|---|---|
| 1 | `taba2qa81704` | 32/32 OK | **falló** (2/5) | el CHECK `reviewer_follows_decision` impedía borrar al revisor → migración 106 |
| 2 | `taba2qa81710` | 32/32 OK | **falló** (2/5) | el guard de membresías bloqueaba el DELETE en cascada de GoTrue → migración 107 |
| 3 | `taba2qa81720` | 32/32 OK | **PASS (5/5)** | nada: la limpieza cerró sola |

Las dos limpiezas manuales fueron acotadas por etiqueta
(`where email like 'taba2qa%@example.com'`) y quedaron verificadas por recuento.

El script se corrigió además para abortar **lanzando** en vez de con
`process.exit`, porque `process.exit` no corre el `finally`: en el primer intento
un fallo temprano se fue sin limpiar. Un smoke que puede abandonar identidades en
producción es peor que no tenerlo.

## 3. Estado final de producción, medido

`supabase db query --linked -f scripts/registration-security-portrait.sql`

| Recuento | Valor |
|---|---|
| `auth.users` | **0** |
| `business_access_requests` | **0** |
| `business_members` | **0** |
| `staff_profiles` | **0** |
| `rider_profiles` | **0** |
| `identity_sessions` | **0** |
| `identity_user_security` | **0** |
| `customers` | **0** |
| `customer_addresses` | **0** |
| `orders` | **0** |
| `order_items` | **0** |
| `products` | **0** |
| `payment_intents` | **0** |
| `riders` | **0** |
| `rider_order_offers` | **0** |
| `businesses` | 1 (la fila canónica de la migración `20260531030000`) |
| `identity_audit_events` | **21** — ver abajo |

## 4. Los 21 eventos de auditoría que quedan, y por qué no se borran

`identity_audit_events` es append-only por trigger y, desde la migración
`20260812070000`, **tampoco tiene claves foráneas hacia `auth.users`**. Las dos
cosas son deliberadas:

* el trigger impide `UPDATE` y `DELETE` incluso desde una función `definer`;
* la falta de FK existe porque, si al borrar la cuenta se pusiera su identificador
  en `null`, la auditoría perdería justamente el dato por el que existe.

O sea: una auditoría que se borra con lo que audita no es una auditoría.

Lo que quedó, por las tres corridas:

```
session_opened            × 9
access_requested          × 6
access_request_approved   × 6
```

Contenido: los uuid de las cuentas QA (que ya no existen) y, en la metadata, el
**dominio** del correo (`example.com`), nunca el correo completo. Sin PII, sin
tokens, sin datos comerciales.

Esto **no** se lista entre los recuentos que la misión exige en cero: la misión
pide 0 identidades, 0 membresías, 0 solicitudes, 0 perfiles, 0 direcciones y
0 riders QA, y las seis están en cero. Los eventos de auditoría son el rastro
inmutable de que el circuito se probó, y se informa acá para que nadie lo
descubra después.

## 5. Los dos defectos que este smoke encontró

Ninguno de los dos era visible desde un stack local, y los dos por el mismo
motivo: dependían de que la conexión **no** fuera la de un superusuario.

### 5.1 El revisor no podía borrar su cuenta (defecto propio, migración 106)

`decided_by` es `on delete set null`, y el CHECK original exigía
`(decided_at is null) = (decided_by is null)`. Juntas: en cuanto una persona
aprobaba una sola solicitud, su cuenta ya no se podía borrar nunca.

### 5.2 Ninguna cuenta con membresía se podía borrar por Auth (defecto preexistente, migración 107)

`business_members.user_id` es `on delete cascade`, y ese DELETE lo dispara el
motor. El guard de membresías miraba **quién** llama, no **qué** pasa, y GoTrue
borra con su propio rol. Neto: la cuenta de cualquier integrante de un comercio no
se podía borrar por la única vía que tiene el tablero de Supabase, ni por la única
que tendría un pedido de baja de datos personales.

Venía desde la migración `20260812080000` y apareció ahora porque este es el
primer circuito que crea una persona, la hace miembro y después intenta borrarla.
