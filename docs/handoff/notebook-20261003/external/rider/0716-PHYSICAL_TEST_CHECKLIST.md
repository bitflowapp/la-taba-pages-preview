# La Taba Rider Android — physical validation checklist

Commit under test: `cfce79fb1a6910676252b7def3fee451830b8b7c`

APK scope: staging debug only. This checklist records tests still requiring human/device validation; none of the items below is asserted as executed by automation.

- [ ] Login real
- [ ] Membership rider
- [ ] Claim concurrente
- [ ] Cambio Wi-Fi/datos
- [ ] Modo avión
- [ ] Movimiento GPS real
- [ ] Pantalla apagada
- [ ] Permiso denegado
- [ ] Permiso revocado
- [ ] Notificación recibida
- [ ] Toque de notificación
- [ ] Entrega con código
- [ ] Código incorrecto
- [ ] Rate limit
- [ ] Reinicio del teléfono
- [ ] Cancelación
- [ ] Finalización del foreground service

Permission and system-state items to verify explicitly during the physical pass:

- [ ] Ubicación precisa
- [ ] Ubicación en segundo plano
- [ ] Notificaciones
- [ ] Optimización de batería
- [ ] Servicio en primer plano
- [ ] GPS del sistema
