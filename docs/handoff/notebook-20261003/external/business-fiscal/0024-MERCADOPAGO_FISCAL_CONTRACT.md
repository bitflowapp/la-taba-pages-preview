# Contrato Mercado Pago → fiscal

```text
Pago aprobado
→ pedido confirmado
→ evento fiscal según política
→ fiscal_outbox
→ documento pendiente
→ ARCA
→ CAE
→ QR
→ PDF
```

- Una falla ARCA no rechaza el pago aprobado ni borra el pedido.
- No se inventa CAE; el documento queda en outbox y se alerta al operador.
- Timeout o respuesta truncada es ambiguo: se consulta antes de reenviar.
- Refund financiero no genera automáticamente nota de crédito.
- Contracargo se registra y alerta; no cambia stock ni emite nota automática.
- La política contable debe estar aprobada y versionada antes de resolver tipos fiscales.
