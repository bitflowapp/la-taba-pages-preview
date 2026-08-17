# TABA2 · Matriz de acceso · lo que agrega esta misión

Medido contra `la-taba-production` (`wwcpogltfgzgkrlilbcd`) después del push, con
`scripts/registration-security-portrait.sql`. Los valores de la columna
«producción» salen del catálogo real, no del texto de las migraciones.

## 1. Tablas

| Tabla | RLS | Policies | `anon` | `authenticated` | Cómo escribe el cliente |
|---|---|---|---|---|---|
| `business_access_requests` | **on** | 0 | ninguno | ninguno | sólo por RPC |
| `business_members` | on | 6 | ninguno | `SELECT` | sólo por RPC de identidad |
| `staff_profiles` | on | — | ninguno | `SELECT` | sólo por RPC de identidad |
| `rider_profiles` | on | — | ninguno | `SELECT` | sólo por RPC de identidad |
| `identity_user_security` | on | — | ninguno | ninguno | sólo por RPC |
| `identity_audit_events` | on | — | ninguno | ninguno | sólo por función definer |
| `customers` | on | 1 | ninguno | `SELECT` (propio) | sólo por RPC |
| `customer_addresses` | on | 1 | ninguno | `SELECT` (propio) | sólo por RPC |

`business_access_requests` tiene **RLS activa y cero policies**. Con cero grants
la tabla ya es inalcanzable; la RLS está ahí para que ninguna vía futura la abra
por descuido.

Medición de producción: `client_write_grants = []` sobre las 86 tablas, y
`registration.table_grants = []`.

## 2. Funciones nuevas

| Función | Definer | `search_path` | `public` | `anon` | `authenticated` | Autoridad interna |
|---|---|---|---|---|---|---|
| `request_business_access` | sí | fijo | no | **no** | sí | `auth.uid()` + no anónimo |
| `get_my_business_access_request` | sí | fijo | no | **no** | sí | `user_id = auth.uid()` |
| `identity_list_access_requests` | sí | fijo | no | **no** | sí | `identity.members.read` |
| `identity_review_access_request` | sí | fijo | no | **no** | sí | `identity.members.write` + no auto-revisión |
| `business_access_request_retry_delay` | no | fijo | **no** | **no** | **no** | interna |

`authenticated` puede *llamar* a las cuatro primeras porque la autoridad vive
adentro, no en el grant. La quinta no la ejecuta nadie más que las otras cuatro.

## 3. Efecto sobre el retrato de seguridad

| Eje | Antes (ledger 103) | Después (ledger 107) | Lectura |
|---|---|---|---|
| tablas | 85 | 86 | la tabla nueva |
| RLS activa | 85 / 85 | 86 / 86 | sin agujeros |
| RLS faltante | 0 | 0 | igual |
| policies | 66 | 66 | la tabla nueva no agrega ninguna |
| `SECURITY DEFINER` | 220 | 224 | las 4 RPC nuevas |
| definers sin `search_path` | **0** | **0** | igual |
| definers ejecutables por `anon` | **8** | **8** | **el alta no agrega superficie anónima** |
| grants de escritura a `anon`/`authenticated` | **0** | **0** | igual |
| `CREATE` sobre `public` para anon/authenticated | no | no | igual |
| vault accesible por anon/authenticated | no | no | igual |

Los 8 definers ejecutables por `anon` son exactamente los mismos 8 de antes:
`can_access_order`, `check_scheduler_watchdog`, `commerce_availability`,
`get_public_business_contact`, `get_public_order_tracking`,
`list_business_combos`, `resolve_business_combo`, `scheduler_heartbeat`.

## 4. Aislamiento entre personas (BOLA)

Todas verificadas dos veces: en la suite pgTAP contra un stack reconstruido
0 → 107, y contra producción real por HTTP en el smoke sintético.

| Intento | Resultado |
|---|---|
| Cliente B lee el perfil de A | perfil `null`, direcciones `[]` |
| Cliente B lee `customers` como `authenticated` | sólo su propia fila; la de A no existe para él |
| Cliente B pone como predeterminada una dirección de A | 42501 / 403 |
| Cliente B borra una dirección de A | 42501 / 403 |
| Cliente B edita una dirección de A pasando su id | 42501 / 403 |
| Solicitante lee `business_access_requests` | 403 |
| Solicitante inserta en `business_members` | 403 |
| Solicitante aprueba su solicitud | 42501 |
| Solicitante abre la bandeja | 42501 / 403 |
| Empleado con sesión válida aprueba | 42501 |
| Rider aprueba a otro Rider | 42501 |
| Owner del comercio 2 aprueba una solicitud del comercio 1 | 42501 |
| Owner del comercio 2 abre la bandeja del comercio 1 | 42501 |
| Owner del comercio 2 lista su propia bandeja | 0 solicitudes: no cruzan |
| Owner se aprueba a sí mismo | `self_review` |
| Sesión anónima pide acceso al equipo | `not_authenticated` |

## 5. Defensa en profundidad sobre `business_members`

Tres capas, y las tres se comprobaron por separado:

| Capa | Qué la sostiene | Cómo se verificó |
|---|---|---|
| 1 · grants | `authenticated` no tiene `INSERT`/`UPDATE`/`DELETE` | `has_table_privilege` + intento real → 42501 |
| 2 · RLS | las policies preguntan `has_business_role(...)` a la compuerta | control negativo: se devuelve el grant dentro de la transacción y la RLS sigue rechazando |
| 3 · guard | `identity_guard_membership_write` exige la marca `taba.identity_write` | sólo ejercitable contra un stack alojado; su prueba es el smoke en vivo |

La capa 3 no se puede ejercitar desde `supabase test db` porque su vía de escape
para conexiones directas mira `session_user`, que ahí es `postgres`. Queda dicho
en la suite en vez de fingir que se probó, y con un alambre de tropiezo para que
un reescribido descuidado se note.
