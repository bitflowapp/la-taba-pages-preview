# Fiscal en el piloto · flujo manual válido

## Estado real, medido

| Hecho | Evidencia |
|---|---|
| Automatización ARCA **no desplegada** | `feature/taba2-arca-fiscal-automation` está **19 commits fuera** de `1d26c4b` |
| **0 comprobantes emitidos** | el preflight verifica `fiscal_documents` y `pos_sales` vacías (`arca_en_cero`) |
| La puerta de activación existe y **falla cerrada** | `evaluateArcaActivation()` exige **9** condiciones |
| La activación pide una frase explícita | `I_AUTHORIZE_ARCA_HOMOLOGATION`, escrita a mano |
| Panel certificado **con ARCA excluida** | lock `taba2-business-panel-hardening` |

Las 9 condiciones: datos fiscales completos (razón social, CUIT válido, condición
frente al IVA, domicilio) · revisión del contador aprobada · certificado cargado,
sin vencer y con CUIT coincidente · delegación verificada · punto de venta > 0 ·
conexión probada · al menos una factura homologada · al menos una nota de crédito
homologada · prueba de impresión y de artefacto.

**Conclusión: el sistema no puede emitir un comprobante hoy, ni por accidente.**
Eso es lo correcto y no hay que tocarlo.

---

## El flujo manual del piloto

Mientras ARCA no esté homologado, el piloto opera así:

1. **El pedido se cobra y se entrega normalmente.** Nada del circuito comercial
   depende de la facturación: precio, stock, reserva, pago, Panel y Rider son
   independientes del módulo fiscal.

2. **El comprobante fiscal lo emite Walter por su medio habitual**, fuera del
   sistema — el que ya usa hoy en el mostrador.

3. **En TABA2 no se marca nada como facturado.** No hay campo que tocar y no hay
   que inventarle uno. Un pedido entregado y no facturado en el sistema es un
   estado honesto: dice exactamente lo que pasó.

4. **La conciliación es por pedido.** Cada pedido tiene su código público
   (`LT-XXXX`), su total decidido por el backend y su historia en el Panel. Esa
   es la referencia contra la cual Walter emite y su contador concilia.

### Lo que está explícitamente prohibido en el piloto

- Marcar un pedido como facturado si no existe el comprobante.
- Activar ARCA «para probar» sin las 9 condiciones y sin el contador.
- Emitir comprobantes reales de prueba.

---

## Cuándo dejar de operar así

El flujo manual deja de ser necesario recién cuando se cumplan **las tres** cosas:

1. las 9 condiciones de `evaluateArcaActivation()` en verde, con el contador
   aprobando;
2. la rama `feature/taba2-arca-fiscal-automation` integrada, certificada y
   desplegada — hoy son 19 commits sin integrar, con su propio riesgo de
   regresión que no se evaluó;
3. homologación de ARCA completa: factura y nota de crédito de prueba
   homologadas, más la prueba de impresión.

Hasta entonces, **el piloto factura a mano y el sistema no miente sobre eso.**

## Decisión pendiente de Walter

Si el piloto emite comprobante por cada pedido o si opera bajo otra modalidad
(consumidor final agrupado, remito, etc.) es una decisión comercial y fiscal que
no se puede inferir del código. **Ese dato falta.**
