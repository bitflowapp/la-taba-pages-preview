# Migración sólo-remota `20260804090000_rider_map_location_contracts`

**Fecha del relevamiento**: 2026-08-06
**Proyecto**: `la-taba-staging` / `ukxqbgswjlibmnjemrzd`
**Modo**: solo lectura vía Management API. **Nada fue modificado.**
**Decisión**: **PRESERVAR**. No se borra, no se reemplaza, no se toca.

---

## 1. Identidad

| Campo | Valor |
|---|---|
| Versión registrada | `20260804090000` |
| Nombre registrado | `rider_map_location_contracts` |
| Presencia en Git | **NINGUNA** — no existe en ninguna rama de este repositorio |
| Archivo local que colisiona | `supabase/migrations/20260804090000_business_operations_panel.sql` (nunca aplicado en staging) |

Verificación de ausencia en Git:
```
git log --all --diff-filter=A --name-only -- 'supabase/migrations/20260804*'
  → sólo 20260804090000_business_operations_panel.sql (commits 085cacf, d1ddec6)
git grep -l 'rider_map_capture_order_location'
  → sin coincidencias en el repositorio versionado
```

Los otros **26** nombres del historial remoto coinciden exactamente con sus archivos locales. La colisión es única y aislada.

---

## 2. Huella material en staging

La migración creó un **esquema `private` completo**, invisible para un inventario que sólo mire `public`.

### Esquema
```
private   —  ACL: postgres=UC/postgres
```
Sin `usage` para `anon`, `authenticated` ni `service_role`. Superficie cerrada.

### Tablas (2) — ambas con RLS habilitada, owner `postgres`

**`private.rider_map_business_locations`**
```
business_id, latitude, longitude, source, accuracy_m, updated_at
```
PK: `rider_map_business_locations_pkey` · filas: **0**

**`private.rider_map_order_location_snapshots`**
```
order_id, business_latitude, business_longitude, business_source, business_accuracy_m,
customer_latitude, customer_longitude, customer_source, customer_accuracy_m, created_at
```
PK: `rider_map_order_location_snapshots_pkey` · filas: **1**

> La única fila contiene coordenadas asociadas a un pedido real. **No se transcribe** su contenido en este documento ni en ningún artefacto.

### Funciones (2)

**`private.rider_map_location_payload(uuid, boolean)`** — lectura del snapshot. Definición no transcrita (no es necesaria para preservarla y reduce superficie).

**`private.capture_rider_map_order_location_snapshot()`** — función de trigger:
```
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
```
Lee `private.rider_map_business_locations` por `business_id` e inserta en
`private.rider_map_order_location_snapshots`, validando rangos
(`latitude between -90 and 90`, `longitude between -180 and 180`) y usando
`on conflict (order_id) do nothing`. Sin comentario asociado.

### Trigger (1)
```sql
CREATE TRIGGER rider_map_capture_order_location
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.capture_rider_map_order_location_snapshot()
```

### Columnas de `public.orders` que consume (creadas por migraciones locales, no por ésta)
```
delivery_latitude, delivery_longitude, delivery_address_source, delivery_geolocation_accuracy
```
Las 18 columnas `delivery_*` de `public.orders` provienen del historial local y están presentes.

---

## 3. Por qué se preserva

1. **Es una migración real y aplicada**, no un registro fantasma. Tiene efecto material verificado.
2. **Su fuente no está en este repositorio**, así que no puede reconstruirse desde acá. Borrar su registro destruiría la única evidencia de que corrió.
3. **Contiene un dato real** (1 snapshot). Un `DROP` haría perder información de producción de staging.
4. Su superficie está **cerrada** (esquema `private` sin grants a roles de aplicación), por lo que no interfiere con el contrato del Panel ni con Mercado Pago.

## 4. Consecuencia para la reconciliación

La versión `20260804090000` queda **ocupada de forma permanente** en staging por esta migración. Por lo tanto:

- `supabase/migrations/20260804090000_business_operations_panel.sql` **nunca podrá aplicarse a staging bajo esa versión** — `db push` la saltea por definición.
- El contrato del Panel se entrega mediante una **migración nueva de reconciliación** con versión libre posterior.
- La reconciliación **no debe tocar** el esquema `private`, sus tablas, sus funciones ni el trigger `rider_map_capture_order_location`.

## 5. Copia documental

No se coloca ninguna copia en `supabase/migrations/` — volvería a ejecutarse.
La definición del trigger y de su función queda registrada acá y, en forma SQL, en
`docs/migrations/remote-only/` del repositorio, **fuera** del directorio de migraciones.

Sin secretos. Sin datos humanos. Sin coordenadas.
