# Pre go-live · lo que está medido y lo que falta

Medido en vivo el **2026-08-18** contra `wwcpogltfgzgkrlilbcd`.

## Preflight (Fase 0) — PASA

| | |
|---|---|
| proyecto | `wwcpogltfgzgkrlilbcd` · `postgres` |
| ledger | **107** · última `20260817040000` |
| scheduler | latido hace **30 s** |
| identidades | 2 (owner + Rider) · **0 anónimas** · 0 residuo QA |
| owners activos | **1** |
| riders activos | **1** · `rider_profiles.status = active` |
| pedidos · checkouts | **0** · **0** |
| tablas | 86 · **0 sin RLS** |
| `ordering_enabled` | **false** |

## Host y paquete (Fases 8 y 9) — PASA

`https://la-taba.pages.dev` responde **200**, con `mode: production`,
host `wwcpogltfgzgkrlilbcd.supabase.co`, negocio canónico y clave **publicable**.

Buscado en el paquete publicado: **0** referencias al ref de staging y **0** a
`sb_secret_` / `service_role` en `app.js`, `state.js` y `runtime-config.js`.

## Lo que falta, y por qué la persiana no se puede abrir todavía

Ver `BUSINESS-CONFIG.md`, `CATALOG-PRODUCTION.md` y `GO-LIVE-STATE.md`.
