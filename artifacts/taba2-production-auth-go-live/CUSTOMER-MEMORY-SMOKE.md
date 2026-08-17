# Memoria del Cliente contra producción · informe

**25 de 25 pasos.** Corrido el 2026-08-17 contra `wwcpogltfgzgkrlilbcd`.
Datos crudos: `CUSTOMER-MEMORY-SMOKE.json`.
Herramienta: `npm run production:smoke:customer`.

---

## Identidad

| paso | resultado |
|---|---|
| el ingreso anónimo funciona | HTTP 200 |
| el JWT dice `is_anonymous=true` y `role=authenticated` | ✓ |

El Customer **no cambió**: sigue entrando anónimo, como siempre. Endurecer el
Auth de correo no lo tocó.

## Perfil y direcciones

| paso | resultado |
|---|---|
| guarda nombre y teléfono | ✓ `name="Cliente QA"` |
| el teléfono se normaliza **en el servidor** | `2995551234` |
| guarda la primera dirección | ✓ |

## Volver más tarde (esto es «recargar»)

| paso | resultado |
|---|---|
| la sesión se restaura con el refresh token | HTTP 200 |
| y sigue siendo la misma persona | mismo `sub` |
| el perfil vuelve con el nombre guardado | ✓ |
| y con la dirección guardada | 1 dirección |
| la primera dirección queda como predeterminada | `isDefault=true` |

## Varias direcciones

| paso | resultado |
|---|---|
| guarda una segunda dirección | ✓ |
| cambiar la predeterminada funciona | ✓ |
| **nunca hay más de una predeterminada** | 1 (verificado por SQL) |
| y es la que se eligió | la segunda |
| borrar una dirección es **borrado lógico** | ✓ |
| la vieja sigue existiendo para la historia de entregas | vivas 1 · históricas 2 |

## Aislamiento entre personas

Persona **B**, anónima, contra los datos de **A**:

| paso | resultado |
|---|---|
| B no ve el perfil de A por RPC | ✓ |
| B no lee la fila de A en `customers` | 0 filas |
| ni ninguna dirección de A | 0 filas |
| B no puede tocar una dirección de A | `42501` |
| **nadie escribe `customers` por tabla, ni su propia fila** | HTTP 403 |

Toda escritura pasa por RPC `SECURITY DEFINER` que derivan `auth.uid()` y no
aceptan un identificador de persona en su firma.

## Una identidad anónima no es Panel ni Rider

| paso | resultado |
|---|---|
| no obtiene rol en el comercio | `role=null` |
| no puede pedir acceso de equipo siendo anónima | `not_authenticated` |

## Limpieza

```
usuarios 0 · clientes 0 · direcciones 0 · pedidos 0
```

`ordering_enabled = false`. **No se creó ningún pedido**: la persiana está
cerrada y la sonda no la toca.

---

## Un defecto que esta corrida ayudó a encontrar

Mientras se medía, aparecieron en producción **dos identidades anónimas que
nadie de esta misión había creado**: sin perfil, sin dirección, sin pedido,
creadas con un segundo de diferencia justo después de publicar el sitio.

Eran visitas. El arranque de la aplicación pedía el perfil guardado, y pedirlo
creaba una identidad anónima **antes de que la persona tocara nada**. O sea que
cada visita —incluida la de un robot que ejecuta JavaScript— dejaba una fila
permanente en `auth.users`.

Arreglado en `fix(cliente): leer el perfil guardado no puede crear una
identidad`: la lectura del arranque ahora pide la sesión con
`createIfMissing: false` y, si no hay, contesta «no hay nada guardado» —que es
exactamente lo que contestaría el servidor, porque la RLS mira `auth.uid()`—.
La identidad se crea cuando la persona **guarda** algo.

Verificado después de publicar el arreglo: `auth.users = 0` y sin identidades
nuevas.
