# Troubleshooting

| Síntoma | Acción segura |
| --- | --- |
| `CHECKOUT_NOT_AVAILABLE` | Revisar sesión vigente, stock reservado, precio confirmado, negocio/modalidad habilitados y settings no secretos. |
| `PREFERENCE_RECONCILING` | No crear otra preferencia: buscar por `external_reference` y esperar la reconciliación. |
| Retorno dice aprobado pero no hay pedido | El retorno no es autoridad. Consultar checkout server-side y receipts/outbox. |
| Pago aprobado luego de expiración | Mantener `manual_review_required`; verificar stock y política comercial antes de actuar. |
| Webhook inválido | Revisar secret/headers/`data.id` y reloj; no reprocesar body a mano ni desactivar la firma. |
| Worker en dead letter | Corregir configuración o discrepancia, reconciliar por API y conservar evidencia antes de reintentar. |
| Refund ambiguo | Usar el ID y la clave idempotente ya auditados; consultar payment/refunds antes de otro POST. |

No registrar payload completo del proveedor, tarjetas, CVV, tokens, Access Token ni secret de webhook durante el diagnóstico.
