# Despliegue de staging

Estado al 2026-08-03: **NO DESPLEGADO**.

## Verificaciones completadas

- Proyecto `la-taba-staging`, ref exacto `ukxqbgswjlibmnjemrzd`, `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.147.
- Worktree enlazado explícitamente al ref staging.
- Historia remota: 26 migraciones antes y después de los dry-runs.
- Edge Functions remotas: 0.
- Secretos custom remotos: 0.
- Dry-run con inclusión histórica: PASS, exactamente 4 migraciones, 0 seeds y 0 roles.
- Comercio público: uno, abierto, activo, ordering habilitado/verificado, ARS, delivery y pickup habilitados.
- Catálogo remoto público: 9/9 productos verificados, activos, disponibles, con precio positivo, stock positivo y `external_id`.
- Membresías: un owner activo; doce riders, cuatro activos; sin identidades registradas.

## Frontend

El único Pages encontrado fue `https://bitflowapp.github.io/la-taba-pages-preview/`, HTTPS y actualmente demo fail-closed. Su `runtime-config.js` no contiene el ref staging ni una publishable key activa. No es un storefront staging conectado y no se reemplazó.

## Auditoría de este turno

El CLI local mostró `supabase/config.toml` con `project_id = la-taba-real-orders-staging`, que no es el ref autorizado `ukxqbgswjlibmnjemrzd`. `supabase migration list --linked` terminó en timeout; no se ejecutó `supabase link`, dry-run remoto, push, deploy ni cambio de secrets. La cantidad remota y el dry-run quedan sin reconfirmar en este turno.

## Bloqueos de despliegue

1. autenticación/aplicación Mercado Pago pendientes;
2. credenciales test pendientes;
3. dominio HTTPS de staging separado pendiente;
4. Webhook test pendiente;
5. SQL local nuevo no aplicado porque Docker no respondió al preflight;
6. ninguna mutación remota autorizada hasta cerrar los puntos anteriores.

No se tocaron producción, migraciones remotas, Functions, Auth, datos ni frontend.
