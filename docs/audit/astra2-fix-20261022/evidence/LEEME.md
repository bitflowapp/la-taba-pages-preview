# Evidencia (saneada: sin rutas locales ni datos privados; sólo datos sintéticos y proveedor simulado)

Cada archivo es la salida cruda de `node --test` en el momento indicado. Son una **cronología**, no un resultado final: las
fallas que aparecen en los registros «verdes» tempranos eran errores de **mis pruebas** (se corrigió la prueba, no el código)
y están descritas en el informe.

| Archivo | Qué es | Código |
|---|---|---|
| `red-recon.txt` | A1–A9, 9/9 **rojos**: reembolso tardío no visto, huérfano que se queda en `low`, ventana que no pasa el tope de paginación, relectura de pendientes en cada tick, checkout rechazado releído para siempre, pedido pagado sin verificación. | auditado (`c99b1068`) |
| `red-time.txt` | B1–B3, 3/3 **rojos**: 8 de 8 invocaciones muertas por la plataforma, un trabajo sano que nunca se procesa, 4 trabajos reclamados que nunca corrieron. | auditado |
| `red-sql.txt` | C1–C12 contra el esquema auditado (rojos: las funciones y columnas no existen). | auditado |
| `red-crash.txt` | B4/B5 (corte del proceso en cada punto) **verdes también en el código auditado**: el sistema ya era seguro ante un corte; lo que fallaba era la continuidad. | auditado |
| `green-recon.txt` | Primera corrida verde de A1–A9: 7/9; A5 y A9 fallaban por errores de mi escenario (el cambio quedaba después del fin de la ventana; el envejecimiento no alcanzaba el siguiente escalón). | intermedio |
| `green-time.txt` | B1–B3 verdes. | intermedio |
| `db-suite-fix2.txt` | Suite completa de la base: 110 de 113; las 3 fallas eran pruebas de la ronda anterior que fijaban el comportamiento que este ciclo cambia a propósito (se actualizaron). | intermedio (antes de la revisión independiente) |
| `green-ac.txt` | A1–A12 y C1–C15 sobre el código final: 24 verdes y 3 fallas de prueba (A10 esperaba ≥ 6 corridas, C10/C11 olvidaban conectar un vendedor); corregidas y repetidas en verde (no guardado en archivo). | final |

Falta: el registro de la suite completa sobre el código final (la detuvo el sistema por falta de memoria).
