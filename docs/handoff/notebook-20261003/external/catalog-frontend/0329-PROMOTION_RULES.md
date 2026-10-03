# Reglas y precios sugeridos — promociones candidatas

**Ninguna promoción de este documento está activa ni visible para el cliente.** Todas quedan
con `active=false` y `approval_status=PENDIENTE` en `data/preview-promotions.csv` /
`js/preview-promotions-data.js`, verificado por `tests/promotions.test.mjs` (el CSV sólo puede
sembrar candidatas inactivas hasta que exista confirmación real). Los precios sugeridos de este
documento **no existen en ningún archivo de datos del repositorio** — sólo aquí, para que
Negocio decida.

## Orden de prioridad pedido vs. disponibilidad real de SKU

1. Fernet + Coca-Cola → **BLOQUEADA** (sin SKU de Fernet). Ver `BLOCKED_PROMOTIONS.md`.
2. Cerveza + Gaseosa → **candidata válida**, detalle abajo.
3. Gin + Tónica → **BLOQUEADA** (sin SKU de gin).
4. Vodka + Energizante → **BLOQUEADA** (sin SKU de vodka).
5. Combo Previa → **candidata válida**, detalle abajo.
6. Combo Juntada → **candidata válida**, detalle abajo.

Resultado: 3 candidatas válidas + 3 bloqueadas = 6 promociones evaluadas (dentro del rango
4–6 pedido, contando ambos estados).

## 1. Cerveza + Gaseosa — `promo-candidate-cerveza-gaseosa-combo`

- **SKU**: `heineken-original-lata-473ml-pack-6` ($20.000) + `coca-cola-original-pet-1500ml-pack-6` ($19.999)
- **Cantidades**: 1 pack de cada uno
- **Presentación**: Pack Heineken Lata 473ml x6 + Pack Coca-Cola Original PET 1.5L x6
- **Suma de precios normales**: $39.999
- **Precio promocional sugerido**: $36.999 (ahorro $3.000, ≈7,5 %)
- **Vigencia sugerida**: 30 días desde la aprobación (no cargada — el CSV no tiene `valid_from`/`valid_until`)
- **Disponibilidad**: sólo si ambos componentes están `available=true` y con stock
- **Condición de edad**: sí — hereda automáticamente de `heineken-original-lata-473ml-pack-6.alcoholic=true`.
  El motor (`js/core/promotions.js`) no tiene un campo de edad propio en la promoción; la
  verificación de edad ya existe a nivel de producto/checkout para cualquier línea alcohólica,
  con o sin promoción.
- **Regla de stock**: unidad de venta = 1 pack de cada componente; no fraccionar packs.
- **Fuente/justificación**: combo armado con SKU reales ya publicados. Sin evidencia de acuerdo
  comercial de descuento vigente — precio sugerido a validar por Negocio antes de activar.

## 2. Combo Previa — `promo-candidate-previa-combo`

- **SKU**: `speed-original-lata-473ml` ($2.925) + `imperial-golden-lata-473ml` ($3.000)
- **Cantidades**: 1 lata de cada uno
- **Presentación**: Lata Speed Unlimited 473ml + Lata Imperial Golden 473ml
- **Suma de precios normales**: $5.925
- **Precio promocional sugerido**: $5.399 (ahorro $526, ≈8,9 %)
- **Vigencia sugerida**: 30 días desde la aprobación
- **Disponibilidad**: ambos componentes `available=true` y con stock
- **Condición de edad**: sí — hereda de `imperial-golden-lata-473ml.alcoholic=true`.
- **Regla de stock**: unidad de venta = 1 lata de cada componente.
- **Fuente/justificación**: combo pensado para la previa con SKU reales. Sin evidencia de
  acuerdo comercial vigente — precio sugerido a validar.

## 3. Combo Juntada — `promo-candidate-juntada-combo`

- **SKU**: `heineken-original-lata-473ml-pack-6` ($20.000) + `sprite-original-pet-1500ml-pack-6`
  ($19.999) + `schweppes-tonica-pet-1500ml-pack-6` ($19.999)
- **Cantidades**: 1 pack de cada uno
- **Presentación**: Pack Heineken Lata 473ml x6 + Pack Sprite PET 1.5L x6 + Pack Schweppes
  Tónica PET 1.5L x6
- **Suma de precios normales**: $59.998
- **Precio promocional sugerido**: $54.999 (ahorro $4.999, ≈8,3 %)
- **Vigencia sugerida**: 30 días desde la aprobación
- **Disponibilidad**: los tres componentes `available=true` y con stock
- **Condición de edad**: sí — hereda de `heineken-original-lata-473ml-pack-6.alcoholic=true`.
- **Regla de stock**: unidad de venta = 1 pack de cada componente.
- **Fuente/justificación**: combo grupal con SKU reales, pensado para juntadas de más
  personas que la previa. Sin evidencia de acuerdo comercial vigente — precio sugerido a
  validar.

## Cómo se calcularon los precios sugeridos

Los "precios normales" son la suma exacta de los `price` ya publicados en
`js/approved-beverage-demo-data.js` (hecho verificable, no una invención). Los "precios
promocionales sugeridos" aplican un descuento de referencia de 7,5–9 % — un rango típico de
combo de supermercado/kiosco para bundles de 2–3 ítems — **sin ningún respaldo de acuerdo
comercial real**. Son sólo una propuesta de partida para que Negocio la valide, ajuste o
rechace; no deben interpretarse como precios ya negociados.

## Limitación técnica real del motor de promociones (para revisión de Negocio/Ingeniería)

`discountForBundle` en `js/core/promotions.js` trata `includedSkus` como **un pool de
unidades intercambiables**: la promoción se activa con cualquier combinación de N unidades
entre los SKU listados (por ejemplo, 2 unidades de sólo un SKU también completarían un bundle
de `requiredQuantity=2`), no exige estrictamente 1 unidad de cada SKU distinto. No se modificó
`js/core/promotions.js` en esta tarea (fuera de alcance: es código de checkout/carrito). Antes
de activar cualquiera de las 3 candidatas de arriba, Negocio/Ingeniería debe decidir si este
comportamiento es aceptable para un combo cruzado o si el motor necesita una validación de
composición exacta.
