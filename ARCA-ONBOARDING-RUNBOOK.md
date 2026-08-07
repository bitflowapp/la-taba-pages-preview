# Cómo dejar la facturación andando sola

Para Walter y su contador. Se configura **una vez**. Después, cada venta cobrada
se factura sola y esta pantalla sólo se mira si algo falla.

No hace falta saber nada de ARCA por dentro. Si algo sale mal, el sistema dice
qué pasó y qué hacer, en castellano.

**Dónde:** Panel del negocio → **Facturación** → *Configuración fiscal*.

Cada paso dice **COMPLETO**, **PENDIENTE** o **ERROR**. *Pendiente* es que falta
cargar algo. *Error* es que algo está mal y hay que corregirlo.

---

## Antes de empezar

| Quién | Qué aporta |
| --- | --- |
| **Walter** | Razón social, CUIT, domicilio comercial. Acceso a ARCA con Clave Fiscal. |
| **El contador** | Condición frente al IVA, alícuota, tipo de comprobante, punto de venta. |
| **Soporte técnico** | Monta el certificado en el servidor. La clave privada nunca sale de ahí. |

Nada de esto lo decide el sistema. Si un dato no está declarado, el circuito se
detiene y lo pide: **nunca inventa una decisión fiscal**.

---

## Paso 1 — Datos del negocio

**Quién:** Walter. **Dónde:** *Datos fiscales*.

- Razón social, tal como figura en ARCA.
- CUIT, once dígitos. El sistema verifica el dígito verificador antes de
  guardarlo: si no cierra, es un error de tipeo y lo dice.
- Domicilio comercial.

Estos datos van impresos en cada comprobante.

## Paso 2 — Situación fiscal

**Quién:** el contador. **Dónde:** *Datos fiscales* + política contable.

- Condición del negocio frente al IVA.
- Condición del cliente frente al IVA.
- Qué se vende: productos, servicios o ambos.
- Tipo de comprobante y tipo de nota de crédito.
- Alícuota, si el IVA va discriminado, si los precios ya lo incluyen y cómo se
  trata el envío.

Después, el contador **aprueba** los datos. Aprobar exige escribir una frase
exacta y queda registrado quién la aprobó y cuándo.

> Cada identificador —tipo de comprobante, alícuota, tipo de documento— se
> valida contra las tablas oficiales que el servidor baja de ARCA. Es la
> diferencia entre "el contador escribió 6" y "ARCA reconoce el 6".

## Paso 3 — Punto de venta

**Quién:** Walter, en ARCA. **Dónde:** *Datos fiscales*.

Dá de alta el punto de venta en ARCA para facturación electrónica y anotá el
**mismo número** en el panel. Cada comprobante se numera dentro de ese punto.

## Paso 4 — Certificado ARCA

**Quién:** Walter en ARCA, soporte en el servidor.

1. Soporte genera el pedido de certificado y te pasa un archivo `.csr`.
2. Entrás a **WSASS** con Clave Fiscal, pegás el `.csr`, descargás el
   certificado y lo autorizás al servicio de facturación electrónica.
3. Se lo devolvés a soporte, que lo monta en el servidor.

**La clave privada nunca sale del servidor** y nunca se muestra en el panel. Lo
único que ves acá es la huella, el CUIT del certificado y su vencimiento.

> Cuando el certificado esté por vencer, la pantalla lo avisa. Cuando venza,
> la facturación automática se apaga sola: sin certificado vigente ARCA no
> autoriza nada, y seguir intentando sólo llenaría la bandeja.

## Paso 5 — Verificación

**Quién:** nadie. Lo hace el servidor.

El servidor habla con ARCA y, cuando responde bien, este paso se marca solo. Si
queda pendiente mucho tiempo, avisá a soporte.

## Paso 6 — Facturación automática

**Quién:** Walter. **Sólo se habilita cuando los cinco anteriores están
COMPLETO.**

Escribís la frase exacta que muestra la pantalla y la encendés. Desde ese
momento, cada venta cobrada se factura sola.

Apagarla no pide frase: frenar nunca es la operación peligrosa. Las ventas se
siguen cobrando igual con la facturación apagada.

---

## Qué pasa después

```
venta cobrada
   └─ el sistema arma el comprobante con la política aprobada
        └─ verifica que los importes cierren            ← si no cierran, no sale
             └─ pide la autorización a ARCA
                  ├─ autorizado → comprobante con CAE, en el Panel
                  ├─ rechazado  → a la bandeja, con el motivo
                  └─ sin respuesta → consulta y reintenta solo
```

**Walter no toca nada de esto.** Si algo necesita a una persona, aparece en la
bandeja de la misma pantalla.

### El tablero

- **Ventas del día** — cuántas hubo.
- **Facturadas solas** — cuántas ya tienen comprobante.
- **En camino** — se están procesando. Se resuelven solas.
- **Rechazadas** — ARCA no las aceptó. Requieren al contador.
- **Requieren atención** — están en la bandeja.

Los comprobantes de prueba de homologación se cuentan **aparte**, con su propia
línea, para que nadie lea un número de prueba como facturación del negocio.

### La bandeja

Sólo aparece lo que necesita a una persona:

| Qué dice | Qué hacer |
| --- | --- |
| Falta configuración para poder facturar | Completar el paso que quedó pendiente. |
| Problema con el certificado de ARCA | Renovarlo en ARCA. Hasta entonces no se emite nada. |
| ARCA rechazó el comprobante | Verlo con el contador: hay que corregir y volver a emitir. |
| Los importes del comprobante no cierran | La venta está cobrada. Revisar el detalle con el contador. |
| No se sabe si ARCA lo autorizó | Nada. El sistema lo consulta solo. **No emitirlo de nuevo.** |
| Falta un dato fiscal de esta venta | Completarlo; el comprobante sigue solo. |
| El comprobante no pudo emitirse | Avisar a soporte con el número de venta. |

Si la bandeja está vacía, lo dice. No hay que interpretarla.

---

## Cosas que el sistema hace solo, para que nadie se sorprenda

- **Si cambiás un dato fiscal, la facturación automática se apaga.** La
  verificación que la justificaba dejó de ser cierta. La pantalla explica por
  qué y la volvés a encender cuando esté todo.
- **Si el contador toca la política contable, también se apaga.** Aprobarla no
  apaga nada.
- **Si el certificado vence a mitad de camino, se apaga.** Antes de encolar un
  comprobante que no puede terminar.
- **Nunca se emite dos veces.** Si el sistema no sabe si ARCA autorizó, consulta
  antes de hacer nada. Reenviar a ciegas es la única forma de facturar dos
  veces, y no lo hace.
- **Si los importes no cierran, no se emite.** Se detiene y avisa. Un
  comprobante mal formado consume un número de la secuencia y bloquea el
  siguiente.
- **La venta se cobra igual aunque la facturación falle.** Cobrar es lo primero;
  el problema fiscal vive en el comprobante, no en la caja.

---

## Quién ve qué

| Rol | Ve |
| --- | --- |
| Dueño / encargado | Todo: configuración, tablero, bandeja, comprobantes. |
| Equipo del mostrador | Los comprobantes y el estado. **No** configura ni enciende la automatización. |
| Repartidor | **Nada fiscal.** Ni comprobantes, ni CUIT, ni importes, ni el certificado. |

---

## Lo único que todavía no se puede

**Facturar de verdad.** Hoy todo esto corre contra el ambiente de **pruebas**
(homologación) de ARCA, y los comprobantes salen marcados como tales: llevan un
aviso arriba, otro abajo y una marca de agua en todas las páginas. No se pueden
confundir con una factura real.

Para pasar a facturación real hace falta el certificado de homologación oficial
y, después, una decisión aparte con el contador. Ver `ARCA-FISCAL-HANDOFF.md`.
