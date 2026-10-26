# Entrega reproducible

Leer [INFORME.md](INFORME.md). Base `30af95c1`; rama `audit/codex-payment-validation-20261025`, apilada sobre #156. No hacer merge como parte de esta auditoría.

## Pruebas locales

Usar un clúster PostgreSQL propio en loopback, con nombre de base descartable. No reutilizar clústeres de otra sesión. Las herramientas `scripts/local-db` rechazan bases ajenas al prefijo `taba_local_`.

```powershell
$env:TABA_PG_BIN = '<carpeta con binarios PostgreSQL>'
$env:TABA_LOCAL_PG_PORT = '55469'
$env:TABA_LOCAL_PG_DRIVER = 'pg' # sólo si la distribución existente no incluye psql
node scripts/local-db/bootstrap.mjs taba_local_codex_payment_fixed
$env:TABA_LOCAL_DB = 'taba_local_codex_payment_fixed'
node --test --test-concurrency=1 tests/db/*.test.mjs
node --import ./tests/test-bootstrap.mjs --test --test-concurrency=1 tests/*.test.mjs
npm run check
```

Las nuevas regresiones están en `payment-financial-audit`, `payment-preference-dispatch-audit`, `payment-ledger-adversarial`, `payment-return-cart-audit` y el caso de combos de `checkout-mp-cliente-nuevo.spec.mjs`. Se añadieron guardias y evidencia válida de estado a las pruebas financieras previas; no se eliminan sus aserciones de stock, dinero, autorización o unicidad.

## QA auténtico

`scripts/audit/qa-payment-snapshot.mjs` sólo lee el proyecto QA fijo y el vendedor autorizado; `qa-adversarial-payments.mjs` hace solicitudes negativas y un replay firmado, sin crear pagos. Las herramientas de checkout sí generan reservas/preferencias; usarlas sólo con QA reservado, cuentas identificadas como prueba y una operación que aún haga falta probar. No repetir operaciones exitosas por una captura.

`qa-combo-fixture.mjs prepare|retire` sólo administra los IDs exclusivos del fixture sintético. Retirar lo deja inactivo y conserva inventario e historial. `qa-storefront-combo-probe.mjs --local-client` sirve un único grafo de JavaScript de esta rama en un navegador aislado y lee el backend QA real; no despliega el cliente. `--return-resilience` reproduce el request de estado perdido y parámetros falsos sobre la compra de prueba ya aprobada, sin otro cobro.

`qa-mp-browser.mjs` tiene guardia de pago único por escenario y ejecución, datos de tarjeta oficiales permitidos y una opción para cerrar antes de cargar `/pago/`. El cierre no toma los parámetros como acreditación: se verifica posteriormente con el proveedor y la base. Las sesiones y sus credenciales permanecen fuera del repositorio.

## Orden de revisión y despliegue

1. Revisar las migraciones `20261026010000`, `20261026020000`, `20261026030000` y sus cambios de contrato.
2. Aplicarlas en QA antes de publicar el handler que requiere `claim_mercadopago_preference_dispatch`. Sin el RPC el handler nuevo falla cerrado.
3. Actualizar worker, verificación de conexión y cliente coherente v169; evitar clientes con mezclas de módulos.
4. Certificar la cabeza exacta con CI y completar los bloqueos externos de la matriz.

El dispatcher no recupera automáticamente un claim perdido: morir entre el claim y el envío puede exigir conciliación. El ledger no declara terminados grupos incompletos o mayores al límite del proveedor. La resolución negativa manual de un refund incierto se bloquea hasta obtener su resultado auténtico.
