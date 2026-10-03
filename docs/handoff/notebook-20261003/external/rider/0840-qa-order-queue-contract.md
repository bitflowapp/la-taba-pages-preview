# Contrato real de elegibilidad de la cola Rider

Demostrado desde el SQL de la función, no inferido del comportamiento.

Fuente: `D:\1212\la-taba-migration-fetch-audit\supabase\migrations\
20260802100000_rider_delivery_server_contracts.sql`, línea 231, más
`20260802103000_rider_queue_read_lock_mode.sql`.

## La función

```sql
create or replace function public.get_rider_queue(p_business_id uuid)
...
begin
  perform public.rider_require_active_membership(p_business_id);
  return query
  select o.id, o.public_code, b.name, b.address,
         nullif(btrim(o.customer_neighborhood), ''),
         o.status, o.revision,
         case when o.payment_method = 'cash' then o.total else null end,
         o.payment_method,
         greatest(1, coalesce(sum(oi.quantity), 0)::integer),   -- item_count
         ...
    from public.orders o
    join public.businesses b on b.id = o.business_id
    left join public.order_items oi on oi.order_id = o.id       -- LEFT JOIN
   where o.business_id = p_business_id
     and o.delivery_mode = 'delivery'
     and o.status = 'ready'
     and o.assigned_rider_user_id is null
   group by o.id, b.name, b.address
   order by o.ready_at nulls last, o.created_at
   limit 50;
end;
```

## El contrato mínimo son cuatro condiciones

1. `o.business_id = p_business_id`
2. `o.delivery_mode = 'delivery'`
3. `o.status = 'ready'`
4. `o.assigned_rider_user_id is null`

Más la precondición `rider_require_active_membership(p_business_id)`, que exige
`auth.uid()` no nulo y una fila en `business_members` con `role='rider'` e
`is_active=true`, o lanza `42501`.

## Mi hipótesis principal queda REFUTADA

Sostuve que faltaban `order_items` y que la cola los exigía. **El SQL dice lo
contrario:**

- el join a `order_items` es **`left join`**, no inner: un pedido sin líneas
  sigue apareciendo;
- `item_count` es `greatest(1, coalesce(sum(oi.quantity), 0)::integer)`, o sea
  que el caso "sin ítems" está contemplado a propósito y se reporta como 1.

Que los 31 pedidos de staging tengan al menos un ítem era correlación, no
causa. Es exactamente el error que la instrucción advertía: no concluir por
razonabilidad.

## Comparación

| Requisito de cola | LT-0031 | Pedido sembrado `QA-SMOKE-c1daae11` | Resultado |
|---|---|---|---|
| `business_id` = negocio del rider | sí | sí (único negocio de staging) | ambos cumplen |
| `delivery_mode = 'delivery'` | sí | sí | ambos cumplen |
| `status = 'ready'` | no (`cancelled` hoy) | **sí**, verificado por `Assert-TabaSeededOrderIsClean` | el sembrado cumple |
| `assigned_rider_user_id is null` | — | **sí**, `NoRider=true` verificado | cumple |
| membership rider activa | — | sí, `rol=rider activa=True` | cumple |
| `order_items >= 1` | 1 fila | **0 filas** | **no lo exige la cola** |
| `ready_at` poblado | sí | sí, lo pone la siembra | ambos |

**El pedido sembrado satisfacía las cuatro condiciones.** Era elegible.

## Entonces por qué no apareció

Porque la fase 1 leyó estado cacheado.

Evidencia:

1. El checkpoint marca `durationMs=6517` y `launchApp()` ya duerme 6000 ms: la
   búsqueda del código en pantalla ocurrió a los ~500 ms de terminar el sleep,
   sin ninguna sincronización de por medio.
2. `launchApp()` usa `FLAG_ACTIVITY_CLEAR_TOP`, que **reanuda** la Activity
   existente en vez de arrancar en frío. La app ya estaba abierta desde la
   verificación de precondiciones de las 17:39 con la cola vacía, y esa lista
   seguía en memoria.
3. La fase nunca acciona el control de refresco. La pantalla de cola expone
   `IconButton(tooltip: 'Actualizar pedidos')` y un `RefreshIndicator`, y la
   fase no usa ninguno de los dos.
4. Un desajuste de negocio queda descartado: si el `p_business_id` del APK no
   fuera aquel donde el rider es miembro activo,
   `rider_require_active_membership` habría lanzado `42501` y la app mostraría
   un error. En cambio mostró **"Lista sincronizada"**, que sólo aparece
   después de una llamada autenticada exitosa.

## Clasificación

**C. RIDER_QUEUE_REFRESH_MISSING**

El pedido era elegible; la fase 1 no forzó una lectura nueva.

No es A (los ítems no son requisito, está probado por el `left join`), no es B
(las cuatro condiciones se cumplían y quedaron verificadas por
`Assert-TabaSeededOrderIsClean`), no es D (un solo defecto demostrado) y no es
E (se demostró sin mutar staging, leyendo el SQL de la función).

## Qué se corrige igual

Aunque los ítems no sean requisito de elegibilidad, la siembra los crea a
partir de ahora: un pedido sin líneas no representa nada real, `item_count`
llegaría a la UI como un 1 sintético y el resto del smoke —stock, totales,
entrega— se apoyaría sobre un pedido que no se parece a los que la cola
muestra de verdad. Es correctitud del fixture, no de la elegibilidad, y así
queda dicho para que nadie lo lea como la causa.
