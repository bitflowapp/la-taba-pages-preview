# Promociones bloqueadas — sin SKU real disponible

Estas 3 promociones estaban en la lista de prioridad pedida pero **no se pueden construir**
con el catálogo aprobado actual (22 productos: gaseosas, mixers, energizantes, cervezas). No
se inventó ningún producto para completarlas — quedan documentadas como candidatas bloqueadas,
sin entrada en `data/preview-promotions.csv` ni en `js/preview-promotions-data.js` (no hay SKU
real que referenciar).

## 1. Fernet + Coca-Cola — `promo-candidate-fernet-cocacola` (prioridad #1 solicitada)

- **Motivo del bloqueo**: no existe ningún SKU de Fernet en el catálogo aprobado.
- **Condición explícita del pedido**: "Fernet + Coca-Cola sólo puede activarse si ya existe un
  SKU real de Fernet en el catálogo. Si no existe, se deja como candidata bloqueada — no
  inventar el producto." Se cumple al pie de la letra.
- **Para desbloquear**: dar de alta un SKU de Fernet real y aprobado (marca, presentación,
  precio, imagen con packshot verificado) en el catálogo, y luego repetir este análisis.

## 2. Gin + Tónica — `promo-candidate-gin-tonica` (prioridad #3 solicitada)

- **Motivo del bloqueo**: existe `schweppes-tonica-pet-1500ml-pack-6` (Schweppes Tónica), pero
  ningún SKU de gin.
- **Para desbloquear**: dar de alta un SKU de gin real y aprobado.

## 3. Vodka + Energizante — `promo-candidate-vodka-energizante` (prioridad #4 solicitada)

- **Motivo del bloqueo**: existen energizantes (`red-bull-original-lata-250ml`,
  `speed-original-lata-473ml`, `speed-zero-lata-473ml`, `monster-mango-loco-lata-473ml`), pero
  ningún SKU de vodka.
- **Para desbloquear**: dar de alta un SKU de vodka real y aprobado.

## Resumen

| # prioridad pedida | Combo | Estado |
|---|---|---|
| 1 | Fernet + Coca-Cola | BLOQUEADA — sin SKU de Fernet |
| 2 | Cerveza + Gaseosa | Candidata válida (ver `PROMOTION_RULES.md`) |
| 3 | Gin + Tónica | BLOQUEADA — sin SKU de gin |
| 4 | Vodka + Energizante | BLOQUEADA — sin SKU de vodka |
| 5 | Combo Previa | Candidata válida (ver `PROMOTION_RULES.md`) |
| 6 | Combo Juntada | Candidata válida (ver `PROMOTION_RULES.md`) |

3 de 6 promociones de la lista de prioridad quedan bloqueadas exclusivamente por falta de SKU
real en el catálogo — no por falta de evidencia comercial (ese es un problema aparte que
también afecta a las 3 válidas, ver `PROMOTION_RULES.md`).
