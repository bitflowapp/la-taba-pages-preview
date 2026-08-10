# Panel del negocio: el día a día

Este panel está pensado para que el negocio se opere sin abrir Supabase, Mercado Pago
Developers, ARCA, una consola ni SQL. Todo lo que aparece en pantalla está en castellano
de mostrador y cada acción explica qué hace antes de hacerla.

## Cómo se lee una alerta

Cada alerta del Centro de operación responde siempre las mismas cuatro preguntas, en este orden:

1. **Qué pasó** — una frase, sin códigos.
2. **Qué se conserva** — qué queda guardado igual. Esto existe para que nadie entre en pánico
   y "arregle" algo cobrando o emitiendo dos veces.
3. **Riesgo** — qué puede salir mal si no se hace nada, o si se hace lo primero que se le ocurre a uno.
4. **Qué conviene hacer** — la acción recomendada, con un botón que lleva a la pantalla que la resuelve.

El identificador técnico existe, pero vive dentro de **Detalle para soporte**. Nunca se muestra
solo ni se mezcla con el texto operativo.

### Equivalencias para soporte

La referencia que ve el operador es estable y no usa vocabulario interno. Esta es la tabla
para traducirla cuando alguien escribe pidiendo ayuda:

| Referencia visible | Condición interna |
| --- | --- |
| `TABA-PAGO-01` | `PAYMENT_APPROVED_WITHOUT_ORDER` |
| `TABA-PAGO-02` | `PAYMENT_RECONCILIATION_REQUIRED` |
| `TABA-PAGO-03` | `PAYMENT_OUTBOX_STALLED` |
| `TABA-ARCA-01` | `FISCAL_AUTHORIZATION_AMBIGUOUS` |
| `TABA-ARCA-02` | `FISCAL_OUTBOX_STALLED` |
| `TABA-ARCA-03` | `FISCAL_ARTIFACT_STALLED` |
| `TABA-IMP-01` | `PRINT_JOB_FAILED` |
| `TABA-ENVIO-01` | `RIDER_SIGNAL_STALE` |
| `TABA-PAGO-04` | `PAYMENT_WORKER_IDLE` |
| `TABA-PAGO-05` | `CHECKOUT_PROVIDER_UNVERIFIED` |
| `TABA-SIST-01` | `SCHEDULER_JOB_FAILING` |
| `TABA-SIST-02` | `SCHEDULER_JOB_STALLED` |
| `TABA-PED-01` | `ORDER_NOT_ACCEPTED` |
| `TABA-PED-02` | `ORDER_STALLED` |
| `TABA-ENVIO-02` | `ORDER_READY_WITHOUT_RIDER` |
| `TABA-STOCK-01` | `STOCK_RESERVATION_STUCK` |
| `TABA-SERV-01` | señal de salud de un servicio degradado |
| `TABA-GEN-01` | cualquier condición todavía sin traducción propia |

Junto a la referencia se muestra un **rastro** de ocho caracteres: es el prefijo del
identificador de correlación y alcanza para encontrar el caso en los registros del servidor.

## Cómo viene el sistema

Debajo de «Qué resolver» hay una sección que contesta lo que un tablero vacío no contesta:
si esto se está mirando solo. **Las alertas ya no se calculan sólo cuando alguien abre el
Panel**: una tarea automática las revisa cada minuto, y esa sección dice cuándo fue la
última revisión, si las tareas automáticas están corriendo, cómo viene la cola de cobros,
si hay dinero cobrado sin pedido, cuántos pedidos necesitan una persona y si la
configuración de cobros está cargada.

Dos cosas que conviene saber leer:

* **«Vigilancia automática: Detenida»** significa que el tablero puede estar vacío porque
  nadie está mirando, no porque no pase nada. Es la única línea que hay que mirar antes de
  confiar en un tablero limpio.
* De la configuración de cobros se muestra **si está cargada**, nunca su contenido. Ningún
  valor de la bóveda llega al navegador.

## Quién puede hacer qué

| Acción | Equipo | Dueño / Encargado |
| --- | --- | --- |
| Ver y avanzar pedidos | Sí | Sí |
| Preparar y empaquetar | Sí | Sí |
| Escanear, contar y recibir mercadería | Sí | Sí |
| Imprimir y reimprimir | Sí | Sí |
| Consultar pagos | Sí | Sí |
| Abrir el negocio y probar dispositivos | Sí | Sí |
| Abrir un borrador de producto | Sí | Sí |
| Cargar o cambiar precios | No | Sí |
| Publicar un producto en la web | No | Sí |
| Devolver dinero y conciliar pagos | No | Sí |
| Configurar la facturación y autorizarla | No | Sí |
| Cerrar el día | No | Sí |
| Administrar el equipo | No | Sí |

Cuando falta un permiso el panel no dice "no autorizado": explica por qué esa acción
la confirma otra persona. El servidor vuelve a validar todo de todos modos.

## Abrir el negocio

"Abrir el negocio" revisa ocho cosas: internet, el sistema del negocio, los cobros por la web,
la facturación, el lector, las impresoras, los repartidores y lo que quedó pendiente de antes.

El resultado es siempre uno de tres veredictos:

- **Todo listo para vender.**
- **Podés vender, facturación pendiente** — se cobra normalmente, pero hoy no salen comprobantes.
- **No habilites cobros** — falta algo esencial, o algo esencial no se pudo verificar.

Lo que no se pudo verificar **no** se asume bueno. Que el servidor haya contestado sí cuenta
como prueba de que hay internet; el lector y las impresoras quedan "sin verificar" hasta que
se prueben desde **Dispositivos**.

## Cerrar el día

El cierre muestra ventas, cobros por Mercado Pago, efectivo, devoluciones, pedidos, movimientos
de stock, comprobantes, diferencias y lo que quedó pendiente.

Dos cosas frenan la firma:

- una diferencia de caja sin explicación escrita;
- problemas críticos sin resolver, que exigen además escribir `CERRAR IGUAL`.

Una vez cerrado, el día queda registrado y no se modifica.

## Mercado Pago

El asistente de conexión tiene siete pasos y **cada paso se marca solo cuando hay evidencia real**;
no se guarda una tilde porque alguien la haya puesto. Si un paso posterior ya está verificado, se
muestra cumplido aunque falte uno anterior: el asistente refleja lo que pasó, no una historia prolija.

El **Access Token nunca llega al panel**: vive en el servidor de cobros. En pantalla sólo se ven
los últimos cuatro dígitos de los identificadores públicos de la cuenta.

Los pagos del día se clasifican en siete estados: verificando, aprobado, rechazado, pendiente,
reembolsado, en revisión y aprobado sin pedido. Los que no se deben entregar todavía lo dicen
explícitamente.

Devolver dinero es irreversible: pide motivo y la palabra `DEVOLVER` escrita a mano, y no permite
devolver más de lo cobrado.

## Facturación (ARCA)

El asistente tiene diez pasos y reutiliza el puente fiscal existente. El décimo paso confirma que
**la facturación real sigue apagada**; si alguien la encendió, ese paso pasa a bloqueado y se avisa.

Para empezar a probar contra ARCA hay que escribir exactamente:

```
I_AUTHORIZE_ARCA_HOMOLOGATION
```

El servidor sólo la habilita si además están la aprobación del contador, los datos fiscales
completos y un certificado cargado y no vencido. Habilitar la facturación **real** necesita una
autorización distinta y no se puede hacer desde el panel.

Nunca se muestran ni se guardan en el panel la clave privada, el ticket de acceso ni el
intercambio técnico con ARCA. El último problema se muestra traducido a una frase accionable.

## Dispositivos

"Probar dispositivos" cubre lector, impresora térmica, A4, QR del comprobante y cola de impresión.
Los estados son exactamente estos:

- **Conectado** — respondió.
- **Sin respuesta** — no contesta.
- **Sin papel** — está conectada pero se quedó sin papel.
- **Trabajo enviado** — Windows aceptó el trabajo. *No* quiere decir que haya salido el papel.
- **Impresión no verificable** — no se puede saber si salió.
- **Error** — el dispositivo informó un problema.

**Un trabajo aceptado por el sistema de impresión nunca se reporta como impreso.** La única forma
de marcar una impresión como salida es que una persona lo confirme mirando la impresora.

## Alta de producto

El recorrido es: escanear → buscar si ya existe → abrir borrador → completar → ver cómo queda → publicar.

- Un código desconocido **abre un borrador**, nunca publica un producto.
- El borrador queda con el código, su formato, la fecha, quién lo abrió y el estado **Falta completar**.
- Lo que se detecta se ofrece como sugerencia editable. No se inventa nombre, marca, categoría ni precio.
- Un código ya asignado a otro producto se rechaza con el nombre del producto que lo tiene.
- El factor de pack se valida contra el tipo: una unidad suelta contiene 1; un pack o caja, más de 1.
- **Precio pendiente**: el producto se ve en la web pero no se puede comprar.
- Publicar lo confirma el dueño o el encargado, y queda auditado con quién lo hizo.
- El panel no edita archivos del catálogo: todo pasa por los contratos del servidor.

Cuando algo falta para que el producto aparezca a la venta, el panel lo enumera en vez de publicar a medias.
