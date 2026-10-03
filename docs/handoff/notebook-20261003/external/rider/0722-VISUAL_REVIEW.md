# Revisión visual — TABA2 Rider

Fecha: 2026-08-02  
Fuente: rama `feature/rider-pilot-readiness-ux`, commit `db645b51f89c8862da6ad29af16ec4e194c9cbc6` al momento de la revisión.

## Método y límites

Las capturas `pilot_*.png` se generaron mediante golden tests a 360×780 con fixtures sintéticos (`PR-0001`, comercios/direcciones explícitamente de prueba). Fueron inspeccionadas visualmente una por una: jerarquía, superficies, separación de estados, targets y ausencia de overflow estructural.

Flutter usa la fuente de prueba Ahem para golden tests; por eso los glifos se ven como bloques. Las capturas validan composición y espaciado, no legibilidad tipográfica final. La revisión tipográfica con fuente del dispositivo queda vinculada a la matriz física Moto G15.

| Captura | Estado | Revisión visual | Resultado |
|---|---|---|---|
| `pilot_login_taba2.png` | Login | Superficie clara única, identidad centrada, inputs altos y CTA rojo único. Sin sombras pesadas ni fondo rojo. | PASS estructural |
| `pilot_available_queue.png` | Pedidos disponibles | Cabecera clara, sincronización verde sobria y card con datos agrupados sin cascada de chips. | PASS estructural |
| `pilot_empty_queue.png` | Estado vacío | Distingue cola real vacía y ofrece actualizar; no sugiere pedidos locales. | PASS estructural |
| `pilot_offline_queue.png` | Sin conexión | La advertencia ámbar queda antes de la última card confirmada; la información visible no se vacía. | PASS estructural |
| `pilot_order_detail.png` | Detalle disponible | Bloques operativos y CTA fija separada. Sólo expone zona general antes del claim. | PASS estructural |
| `pilot_claim_pending.png` | Reclamando / acción pendiente | La barra de acción se deshabilita y conserva el único CTA. Validación funcional además cubierta por widget test. | PASS funcional; revisión tipográfica física pendiente |
| `pilot_claim_conflict.png` | Conflicto de claim | El feedback aparece en línea y no transforma localmente el pedido en asignado. | PASS estructural |
| `pilot_location_permission.png` | Permiso de ubicación | La explicación contextual precede la solicitud Android; la captura de overlay se revisará con ADB porque el golden seleccionado no incluye capas de Navigator. | PASS de flujo; overlay físico pendiente |
| `pilot_gps_active.png` | GPS activo | Verde reservado para publicación confirmada; muestra confirmación reciente y no coordenadas. | PASS estructural |
| `pilot_gps_weak.png` | GPS débil / ubicación pendiente | Ámbar, texto e ícono distinguen señal débil de estado activo. | PASS estructural |

## Estados no capturados deliberadamente

No se generaron pantallas falsas para `retiré`, `llegué`, código de entrega, rate limit de código o `delivered`: el puente/backend actual no expone RPCs para esas transiciones. Tampoco hay credenciales live para obtener cola real sin datos sintéticos. Esos ítems son bloqueos reales, no PASS simulados.

## Hallazgos de diseño

- La acción primaria queda fija en detalle; los controles técnicos se vuelven secundarios y piden confirmación.
- La señal GPS, estado del servicio y sincronización se presentan por texto, icono y color funcional.
- El lenguaje evita confirmar mutaciones antes del servidor, especialmente para claim, delivery start y offline.
- Se necesitan capturas ADB legibles y recorrido real bajo luz exterior para cerrar la revisión de fuente, contraste y uso con una mano.

## Privacidad de evidencia física

La captura ADB inicial coincidió con la pantalla de bloqueo del equipo y contenía notificaciones personales. Se sustituyó inmediatamente por un fixture sintético seguro; no se conserva ni se evalúa como captura física de la aplicación. Por ello la verificación visual en fuente del dispositivo sigue pendiente de una sesión con la pantalla desbloqueada y sin contenido personal visible.
