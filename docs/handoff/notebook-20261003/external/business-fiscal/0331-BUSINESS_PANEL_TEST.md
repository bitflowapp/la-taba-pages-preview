# La Taba — prueba del panel Negocio staging

Fecha: 2026-08-01
Entorno: Supabase staging `ukxqbgswjlibmnjemrzd`
Frontend: `https://bug-mortgage-dude-seems.trycloudflare.com/#business`

## Negocio y acceso

- `business_id`: `00000000-0000-4000-8000-000000000001`
- Nombre: `La Taba`
- Estado: `open`; `is_active=true`; `ordering_enabled=true`
- Membership QA: `7e24806c-e9b6-42f9-b099-7dcb91f3ff54`
- Usuario QA: `542f6931-2050-476c-9cb3-f7e8d0b78254`
- Email QA: `qa-business-staging@local.taba`
- Rol: `owner`; membership activa: `true`
- Contraseña: sólo en `C:\1212\secrets\la-taba-staging-business-login.txt`, fuera del repositorio y con ACL exclusiva del usuario actual.
- Acción de cuenta: contraseña restablecida localmente mediante Admin Auth; HTTP 200. No se creó una membership nueva.

## LT-0004

- Autenticación del panel: correcta; Auth HTTP 200.
- Pedido visible al abrir el panel después de creado: sí.
- Producto: `Coca-Cola Original`, cantidad 1.
- Total: `17.250,00`; entrega a domicilio; pago a coordinar con el local.
- Dirección y referencias QA visibles y consistentes con el pedido.
- Datos internos no visibles en el panel: no aparecen `service_role`, tokens, `customer_user_id` ni datos de memberships.

## Flujo de estados

El estado almacenado inicial fue `received`, que el workflow del repositorio proyecta como `submitted`.

- `received/submitted → accepted`: aplicado desde `Aceptar pedido`.
- `accepted → preparing`: aplicado desde el control de preparación.
- Estado final verificado en Supabase: `preparing`.
- `accepted_at` y `preparing_at`: presentes.
- Historial Supabase: eventos `order.received` y dos `order.status_changed` con transiciones `received→accepted` y `accepted→preparing`.
- LT-0004 no fue completado, puesto en `ready` ni cancelado.

## Persistencia y Realtime

- LT-0004 visible tras recargar: sí.
- LT-0004 recuperado tras cerrar y volver a abrir la sesión: sí.
- Realtime: WebSocket conectado a `wss://ukxqbgswjlibmnjemrzd.supabase.co/realtime/v1/websocket`.
- Errores de página durante la prueba: 0.

## Errores encontrados

- `GET /auth/v1/admin/users` de Supabase devolvió HTTP 500 (`Database error finding users`). No impidió usar el usuario owner existente identificado por membership ni restablecer su contraseña.
- No se modificaron pedidos fuera del flujo solicitado ni se usó `service_role` en el navegador.

## Integridad del repositorio

- Rama: `staging/real-orders-walter`
- HEAD: `c6270589756214eac617515248e93a8e8819190b`
- Estado Git preservado: 9 cambios pendientes de Gate 2; `git diff --check` limpio.
- Sin cambios en `main`, producción, archivos del repositorio, commits, push, merge, reset, restore, stash, clean o deploy.
- Procesos conservados: frontend PID `21228`; wrapper túnel PID `19788`; cloudflared PID `3976`.

No contiene contraseñas, tokens ni claves.
