# La Taba — Checklist de primer día

Objetivo: que una persona no técnica pueda saber si el local está listo para
recibir, cobrar, preparar, entregar y cerrar. Esta checklist es producto/operación;
no habilita por sí sola ningún ambiente real.

## Estados

- `OK`: verificado en el ambiente y dispositivo de uso.
- `REVISAR`: existe capacidad, pero falta evidencia o una decisión del local.
- `BLOQUEADO`: no se debe operar ese tramo hasta resolverlo.
- `N/A`: no aplica al modelo del local; debe quedar justificado.

## Checklist guiada

| Paso | Responsable | Estado de baseline | Qué debe confirmar | Si falla | Resultado visible |
|---:|---|---|---|---|---|
| 1 | Owner | REVISAR | Cuenta autenticada y membresía correcta; empleados/riders activos | detener onboarding y revisar rol | “Acceso listo para: owner / empleado / rider” |
| 2 | Owner | REVISAR | Nombre, dirección, WhatsApp, zona, horarios, prefijo y delivery | corregir datos antes de publicar | “Datos del local completos” |
| 3 | Owner | REVISAR | Catálogo de venta: nombre, precio, stock, presentación y disponibilidad | corregir productos antes de cobrar | “Catálogo verificable” |
| 4 | Owner | BLOQUEADO si sólo está local | Configuración autoritativa del negocio; diferenciar demo/local de producción | no asumir que guardar en el dispositivo publica el negocio | “Configuración operativa confirmada” |
| 5 | Owner | REVISAR | Recepción de pedidos y última sincronización confirmada | reintentar; si persiste, soporte | “Pedidos conectados a las HH:MM” |
| 6 | Owner/admin | BLOQUEADO hasta gate | Mercado Pago: revisión aprobada, secretos backend, webhook y smoke autorizado aparte | operar efectivo/transferencia o pausar online | “Pagos online: listos / pausados / en revisión” |
| 7 | Owner + contador | BLOQUEADO por diseño | ARCA: ambiente, CUIT, punto de venta, certificado, relación y política aprobada | vender sin emisión o usar flujo aprobado alternativo; no editar secretos | “Fiscal: homologación / producción / bloqueado” |
| 8 | Empleado | REVISAR | Impresora seleccionada, papel, prueba física y significado de `unknown` | no prometer comprobante impreso; escalar | “Impresora verificada” |
| 9 | Empleado | REVISAR | Scanner HID: EAN/GTIN válido, desconocido, pack y unidad | ingresar manualmente o crear borrador; nunca ajustar silenciosamente | “Scanner listo” |
| 10 | Empleado | REVISAR | Preparación con un pedido sintético: scan correcto, faltante, offline y reconciliación | no confirmar hasta que la cola esté reconciliada | “Packing confirmado por servidor” |
| 11 | Rider | BLOQUEADO para piloto físico | Login, permisos, GPS real, notificación, batería, background, red y entrega con código | detener piloto Rider | “Rider listo para salir” |
| 12 | Owner | REVISAR | Backup local verificado y diagnóstico sanitizado; contacto de soporte | no iniciar piloto sin canal de recuperación | “Continuidad disponible” |
| 13 | Owner + empleado | REVISAR | Pedido de prueba completo: recibir → preparar → listo → asignar → entregar | registrar incidente y corregir | “Flujo de prueba cerrado” |
| 14 | Owner | REVISAR | Cierre de prueba: efectivo esperado/declarado, diferencia y alerta | documentar diferencia; no cerrar en silencio | “Cierre de prueba auditado” |
| 15 | Owner | GO / NO-GO | No hay P0 abiertos ni evidencia pendiente del dispositivo | pausar el tramo afectado | “Jornada habilitada” |

## Orden de conversación para una persona nueva

El sistema debería mostrarlo así, en lenguaje directo:

1. “Primero revisemos si el local está listo.”
2. “Hay 3 cosas que bloquean vender: pagos, fiscal e impresora.”
3. “Podés operar pedidos mientras revisamos fiscal” o “no podés cobrar online”.
4. “Si una acción queda dudosa, no la repitas: te mostramos cómo verificarla.”
5. “Al final del día declarás efectivo y cerrás con una explicación si hay diferencia.”

## Qué no debe pedir la checklist

- claves privadas, tokens, service role, certificados PEM o secretos de Mercado Pago;
- frases internas como acción cotidiana;
- datos de clientes reales para homologación;
- interpretación contable de tipos fiscales por parte del empleado;
- un “OK” basado sólo en tests automatizados.

## Criterio de salida

El local puede pasar a una jornada controlada sólo si los P0 de dinero, autoridad
de pedido, Rider/piloto y soporte están resueltos, y cada “REVISAR” tiene evidencia,
responsable y fecha de cierre.

