# Customer · qué se ve hoy en el host productivo

`https://la-taba.pages.dev` → **HTTP 200**

| control | resultado |
|---|---|
| `mode` | `production` |
| backend | `wwcpogltfgzgkrlilbcd.supabase.co` |
| negocio | `00000000-0000-4000-8000-000000000001` |
| credencial | **publicable** |
| ref de staging en el paquete | **0** |
| `sb_secret_` / `service_role` en el paquete | **0** |
| host de preview / localhost | **0** |

## Lo que muestra hoy

**«Pedidos no disponibles».** Y es correcto: la política de RLS que hace visibles
los productos exige `ordering_verified` **y** `ordering_enabled`, y las dos están
en `false`. Además no hay ni un producto cargado.

No es un defecto del Customer: es la persiana, funcionando.

## Dry-run del checkout (Fase 10)

No se corrió, y no se puede correr todavía con sentido: sin producto, sin
moneda, sin delivery y sin dirección, el checkout no tiene qué evaluar. El
dry-run va **después** de aplicar la configuración y el catálogo, y antes de
abrir la persiana.
