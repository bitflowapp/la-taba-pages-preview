# Testing

## Local sin credenciales

```powershell
npm run migrations:validate
npm run test:payments
npm run test:webhook
$env:TABA_LOCAL_PAYMENT_DB='1'; npm run test:payments:local-db
npm run secrets:scan
```

La prueba local crea una base temporal con un nombre aislado, aplica todas las migraciones, ejecuta el ciclo PostgreSQL y la elimina al finalizar. Cubre reserva, doble toque, importes manipulados, snapshot de preferencia, aprobación verificada, pedido/stock/evento únicos y receipts duplicados o inválidos.

## Staging obligatorio

Con credenciales de prueba y cuentas de prueba separadas, probar Checkout Pro real en staging:

- approved, pending, in_process, rejected, cancelled y expirado;
- retorno antes/después de webhook, recarga, dos pestañas y pérdida de conexión;
- webhook duplicado, firma inválida, fuera de orden, importe/referencia/`live_mode` inválidos;
- refund de prueba y chargeback simulado si está disponible;
- Chromium, WebKit, Firefox, mobile, teclado y reduced motion.

No sustituir estas pruebas con un cobro real. Ejecutar después `npm run check`, `npm test`, `npm run verify:technical`, la suite E2E completa y los gates de RLS/grants del entorno autorizado.
