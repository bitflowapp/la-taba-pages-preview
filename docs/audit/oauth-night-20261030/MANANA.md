# Acción mínima para continuar mañana

El propietario de TestApp ya quedó confirmado: **A, 3594962708**. No hace falta repetir esa investigación, el escaneo general ni las suites verdes de #161. No hay pago ni enlace OAuth activo preparado durante la noche.

## 1. Acceso legítimo al vendedor B

Se necesita la sesión de la cuenta de prueba **3796774164**. No usar A, la cuenta real de Marco ni la reserva `3796774158`.

Si el titular ya tiene el acceso B, lo introduce personalmente en una ventana privada. Si no lo tiene, entra a [Developers → Integraciones](https://www.mercadopago.com.ar/developers/panel/app) con su cuenta principal y consulta **Cuentas de prueba** de la aplicación donde creó B. Debe comprobar el User ID exacto y el país Argentina antes de usar esos datos. El perfil A no permite administrar esas cuentas: esa restricción ya se observó y no se sortea.

El titular no envía contraseñas ni códigos al chat, no renueva la contraseña y no crea otra cuenta. Si se pide verificación, utiliza el código de la ficha oficial de B; un control personal, CAPTCHA o biometría lo realiza la persona. No se prueba un código a ciegas.

## 2. Un enlace nuevo en el momento

Una vez presente el titular, el operador ejecuta en la rama revisada:

```powershell
node scripts/recovery/qa-mp-e2e.mjs connect-url --tenant b
```

La URL se utiliza en ese momento, sólo con B y en el navegador autorizado. No se guarda en Git, informes, capturas públicas ni logs. No se edita `state` ni `code_challenge`; si vence a los diez minutos, se genera otra. No se reutiliza el enlace del 30/10 a las 05:42 UTC.

**Primera comprobación:** Mercado Pago debe mostrar la autorización de TestApp sin el mensaje anterior. Si vuelve a fallar, no insistir con otras cuentas ni modificar la app por tanteo: conservar únicamente mensaje, hora, App ID y request/correlation ID saneados. La [consulta de soporte preparada](CONSULTA-SOPORTE.md) reúne lo ya descartado.

Si aparece el consentimiento, el titular decide y pulsa **Autorizar**. Este botón no se pulsó durante la misión. Al volver al Panel, el operador comprueba:

```powershell
node scripts/recovery/qa-mp-e2e.mjs verify --tenant b
node scripts/recovery/qa-mp-marketplace.mjs identities --seller 3796774164 --reserve 3796774158
```

Debe figurar `connected` con vendedor **3796774164**, TestApp **4861627125869370**, entorno `test` y verificación de identidad/permisos satisfactoria. Confirmar que B es de prueba mediante la identidad del grant en el servidor, que permanece cifrado; no leer ni copiar tokens al navegador. Si aparece otro vendedor, detenerse sin intentar sustituirlo: hay una regla de vinculación al primer vendedor.

## 3. APRO sólo con la persona compradora presente

La preparación ya comprobada es una unidad de **QA-MKT-001**, ARS **100**, retiro, sin alcohol, stock 5. B sigue cerrado y no tiene pedidos/intenciones. No hay preferencia de pago abierta.

Cuando B esté verificado y la persona compradora de prueba `3594962710` esté presente, tomar exclusividad de QA, crear baseline v2 nueva fuera del repositorio, abrir la ventana limitada y crear el checkout:

```powershell
node scripts/recovery/qa-mp-marketplace.mjs snapshot --out <baseline-nueva-fuera-del-repo.json>
node scripts/recovery/qa-mp-e2e.mjs window-open --tenant b
node scripts/recovery/qa-mp-e2e.mjs checkout --tenant b --sku QA-MKT-001 --qty 1 --scenario APRO
```

La persona abre el `init_point` resultante con la cuenta compradora QA, usa la tarjeta oficial de prueba y el nombre de validación **APRO**, comprueba ARS 100 y paga manualmente. No usa tarjetas reales. Datos oficiales: [compras de prueba Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases).

El operador continúa los workers, inspect, verify con baseline, aviso original, cuatro replays, verify final y cierre de ventana del [preflight de #161](../mp-closure-20261030/PREFLIGHT.md). Exigir todos los criterios verdaderos; datos desconocidos o pendientes no son PASS. Ejecutar el cierre de ventana también ante errores. Después de una devolución hay que verificar el resultado del proveedor y la conciliación; no declararla hecha por la respuesta del navegador.

**No aprobar R-MKT-1** hasta tener compra auténtica aprobada en B, cobrador correcto, pedido único, stock exacto, A intacto, webhook original completado, duplicados idempotentes y conciliación limpia. Si la integradora puede leer un pago como dueña, documentar ese permiso sin convertirlo en un aislamiento inexistente.
