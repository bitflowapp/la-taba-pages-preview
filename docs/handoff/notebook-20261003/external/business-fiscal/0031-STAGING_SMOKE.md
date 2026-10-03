# Smoke Supabase staging — recepción Negocio

Proyecto autorizado: `ukxqbgswjlibmnjemrzd`  
URL esperada: `https://ukxqbgswjlibmnjemrzd.supabase.co`  
Fecha: 2026-08-02

## Restricciones respetadas

- Sólo RPC/UI autorizada con cuentas Auth de staging.
- El smoke usa únicamente key pública + Auth staff. La rotación previa usó una key administrativa sólo en backend/memoria; nunca se entregó al frontend ni se persistió.
- Sin SQL directo privilegiado, migraciones ni `db push`.
- Sin modificar, aceptar, preparar, cancelar ni completar pedidos existentes.
- Los pedidos del smoke deben llevar identidad sintética inequívoca y ser nuevos.
- El relay demo no es autoridad.

## Preflight de credenciales y conectividad

Estado final: **PASS**. El bloque siguiente conserva el preflight histórico anterior a la rotación.

Preflight read-only ejecutado contra el proyecto exacto:

- Auth settings: HTTP 200.
- Lectura pública del business exacto: HTTP 200, una fila.
- Lectura del catálogo activo: HTTP 206, `Content-Range: 0-0/9`.
- Key detectada: `sb_publishable_...`; se rechazó explícitamente cualquier `service_role` o `sb_secret_`.
- Credenciales staff disponibles en scopes Process/User/Machine durante el preflight inicial: no.
- Escrituras intentadas: cero.

Evidencia saneada: `staging-preflight.json`.

Variables requeridas por el smoke de intake:

- `SUPABASE_URL=https://ukxqbgswjlibmnjemrzd.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY` o `SUPABASE_ANON_KEY` pública
- `SUPABASE_BUSINESS_ID`
- `SUPABASE_STAFF_EMAIL`
- `SUPABASE_STAFF_PASSWORD`
- `TABA_SMOKE_CONFIRM=I_UNDERSTAND_THIS_CREATES_SYNTHETIC_ORDERS_IN_STAGING`

Comando preparado:

```powershell
npm run smoke:business-intake:staging
```

El runner `scripts/run-business-intake-staging-smoke.mjs` fue verificado con cuatro tests. Antes de abrir navegador o red exige el project ref exacto, confirmación explícita, UUID del business, key pública no privilegiada y credenciales staff. La config Playwright usa el servidor local sólo para servir archivos; los pedidos, snapshots, Auth, RLS y transiciones consultan el PostgreSQL/Supabase staging real.

No se guardarán valores secretos en este documento ni en logs.

## Casos previstos

1. Autenticar operador staff y verificar membership del business exacto.
2. Elegir un producto verificado con stock suficiente, sin alterar pedidos existentes.
3. Abrir Negocio antes del primer alta y verificar que el pedido sintético llegue completo por snapshot aunque Realtime esté cortado.
4. Crear otro pedido antes de abrir una pestaña nueva y verificar recuperación por snapshot inicial.
5. Abrir tres pestañas y verificar una tarjeta por pedido y una sola alerta global por pedido.
6. Cortar la red de las pestañas, crear un tercer pedido desde el cliente separado y verificar conservación offline y recuperación online.
7. Verificar orden determinista y transición `submitted→accepted→preparing` mediante el panel real.
8. Hacer recarga completa y verificar reconstrucción desde PostgreSQL.
9. Cancelar en `finally` exclusivamente los UUID creados por el run mediante `transition_order`; verificar estados terminales y restauración de stock.
10. Capturar sólo el estado operativo y una tarjeta sintética, nunca el panel completo con posibles pedidos ajenos.

## Resultado

El smoke real se ejecutó con la cuenta QA rotada y membership owner activa. Resultado final: **1/1 PASS**. Creó tres pedidos sintéticos, recuperó la bandeja con Realtime ausente, ejercitó offline/online y tres pestañas, y canceló 3/3 con restauración de stock. Los nueve sintéticos creados durante la operación completa quedaron terminales; ningún pedido preexistente cambió.

Detalle final: `STAGING_SMOKE_FINAL.md` y `CLEANUP_VERIFICATION.md`.
