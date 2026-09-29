# Datos que tiene que dar el comercio para abrir La Taba

Es la única lista: nada de esto se inventa, y ningún otro documento lo pide de nuevo. Con estos datos, cada punto se carga en el Panel siguiendo [`docs/STORE-OPENING-RUNBOOK.md`](../../docs/STORE-OPENING-RUNBOOK.md).

Completar al lado de cada punto. Lo que no se sepa todavía se deja vacío: **vacío = todavía no decidido**, nunca «cero» ni «igual que otro».

## Comercio

- Dueño comercial (quien va a administrar La Taba): nombre y **correo** de Walter:
- Dirección del local para retirar (calle, número, ciudad). Hoy figura «Mendoza 827, Neuquén Capital»; confirmar o corregir:
- WhatsApp del local, con código de país y área (549 + área + número, sin 0 ni 15):
- ¿Ese WhatsApp puede mostrarse en la tienda? (sí/no):

## Equipo

Cada persona entra con su propia cuenta; se invita desde el Panel (Equipo) con su correo.

- Encargados (administran catálogo, horarios, pedidos y equipo), con nombre y correo:
- Empleados (atienden pedidos en el local), con nombre y correo:
- Marco queda como encargado técnico cuando Walter acepte ser dueño (sí/no):

## Horarios

Para cada día: cerrado, o apertura–cierre. Pueden ser hasta 4 tramos por día. Un horario que cruza la medianoche se escribe tal cual, por ejemplo 20:00–02:00.

| Día | Cerrado (sí/no) | Tramo 1 | Tramo 2 |
| --- | --- | --- | --- |
| Lunes | | | |
| Martes | | | |
| Miércoles | | | |
| Jueves | | | |
| Viernes | | | |
| Sábado | | | |
| Domingo | | | |

- Días especiales ya conocidos (feriados, cierres), con fecha:

## Entrega

- Retiro en el local (sí/no):
- Delivery (sí/no):
- Si hay delivery:
  - Barrios o zonas donde se entrega (uno por línea):
  - Costo de envío por zona, o uno general:
  - Pedido mínimo por zona, o uno general (si no hay mínimo, escribir «0»):
  - ¿Quién reparte? (repartidores / el propio local / los dos):
  - Repartidores, con nombre y correo de cada uno (se invitan desde el Panel):

## Catálogo

La planilla [`planilla-apertura-cp.csv`](planilla-apertura-cp.csv) ya trae los 46 productos. El comercio completa:

- `precio` en pesos, sin puntos de mil ni signo: `4200` o `4200.50`. Vacío = todavía no decidido.
- `stock` en unidades contadas en el local. Vacío = sin contar; `0` = contado y agotado.
- `publicar`: `si` o `no`.

Fotos propias de cada producto a publicar, nombradas `<sku>.jpg` (también sirve `<sku>__front.jpg`). La lista exacta, con los 12 prioritarios marcados, está en [`catalog/photo-intake/PHOTO-SHOT-LIST.md`](../photo-intake/PHOTO-SHOT-LIST.md); la guía, en [`catalog/photo-capture/README.md`](../photo-capture/README.md). Hoy sólo Campari tiene foto real aprobada (1/46).

A confirmar:

- Cepita Naranja 1 L: ¿se vende en cartón (Tetra Brik) o en botella? Ver issue #118:
- ¿Hay productos de la lista que el local NO vende? Van con `publicar = no`:

## Pagos

- Efectivo (sí/no):
- Transferencia (sí/no). Si es sí: alias o CBU **que el local pasa por WhatsApp** (no se carga en la tienda):
- Mercado Pago (sí/no). Si es sí:
  - Walter conecta **su** cuenta de Mercado Pago desde el Panel.
  - Walter da su consentimiento para que la plataforma habilite el cobro: fecha y nombre.
- ¿Autorizan un primer pago real de prueba, chico y con devolución? Monto máximo y quién paga:

## Alcohol

Hoy está **cerrado**: 18 productos con alcohol no se venden. Antes de habilitarlo, el comercio decide lo que pide [`docs/ALCOHOL-ACTIVATION.md`](../../docs/ALCOHOL-ACTIVATION.md):

- ¿Se vende alcohol por la web? (sí/no):
- Edad mínima (18 o más):
- Franja horaria de venta de alcohol, con inicio y fin:
- ¿Hay una ordenanza o habilitación municipal que la limite? Número o referencia:

## Facturación (ARCA)

No se activa para abrir. Hace falta para facturar más adelante:

- CUIT y razón social del titular fiscal:
- Condición frente al IVA:
- Punto de venta para facturación electrónica web service (número):
- Tipo de comprobante habitual (Factura B/C u otro, según el contador):
- Certificado y clave de ARCA (homologación primero): los gestiona el titular con su contador. **Nunca se mandan por chat.**
- Delegación del servicio de facturación electrónica a La Taba (sí/no, fecha):
- Política contable para facturar pedidos online, que decide el contador. Sin ella ningún pedido se factura:
  - si cada producto está gravado, exento o no gravado;
  - cómo se factura el envío;
  - cómo se tratan los descuentos;
  - cuándo corresponde una nota de crédito.

## Equipos (opcional)

- ¿Hay impresora térmica en el local? Marca y modelo:
- ¿En qué PC con Windows se instala el agente de impresión?:
- Si hay repartidores: el teléfono Android de cada uno, para instalar la app desde el link del Panel:
