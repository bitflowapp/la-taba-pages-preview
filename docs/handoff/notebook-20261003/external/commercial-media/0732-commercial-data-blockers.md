# Bloqueadores comerciales de datos — TABA2 / La Taba 2

Rama `feature/taba2-commercial-p1-closure` · base `08bb17a0` · 2026-08-05.
Artefacto informativo (fuera del repo). **Nada de esto se resuelve con código**: es información que debe entregar y aprobar el negocio. Ningún valor fue inventado ni estimado; fuentes: dataset demo versionado y `docs/final-commercial-release/remaining-external-data.md`.

## 1. Productos sin precio publicado

- **62 de 82 productos (75,6 %)** tienen `pricePending: true`, sin precio, sin stock y no comprables (`js/taba2-commercial-pending-data.js`: 60; `js/approved-beverage-demo-data.js`: 2 — Red Bull pack x4 y Heineken pack x6).
- Sólo **20 productos son comprables hoy**: 7 gaseosas, 7 cervezas, 4 energizantes, 2 mixers.

## 2. Rubros afectados (sin un solo producto comprable)

| Rubro | Productos | Estado |
|---|---:|---|
| Vinos | 7 | todos pendientes |
| Aguas | 5 | todos pendientes |
| Aperitivos | 5 | todos pendientes |
| Fernet y amargos | 3 | todos pendientes |
| Gin | 3 | todos pendientes |
| Aguas saborizadas | 2 | todos pendientes |
| Isotónicas | 2 | todos pendientes |
| Complementos (hielo) | 1 | pendiente |
| Espumantes | 1 | pendiente |
| Whisky | 1 | pendiente |

**10 rubros enteros** (30 productos) sin comprables; además gaseosas (10), cervezas (10), mixers (7) y energizantes (5) tienen pendientes parciales.

## 3. Piezas editoriales afectadas por esta tanda

Con el criterio de destino comprable (P1-2), hoy quedan **apagadas y reaparecen solas al publicarse precios**, sin tocar código:

- Banner "Selección premium / El mejor whisky" → rubro `whisky`.
- Banner "Clásico argentino / Fernet y amargos" → rubro `fernet`.
- Historia "Jack Daniel's en la barra" → rubro `whisky` (nota: el catálogo ni siquiera tiene productos Jack Daniel's; aunque se publique el precio del Johnnie Walker existente, la pieza seguiría prometiendo otra marca — revisar la pieza en sí).
- Ya estaba apagado por la misma mecánica: banner de marca "Andes Origen" (marca sin productos en catálogo).

Siguen encendidos: hero de cervezas, banner de marca Heineken, historias de cervezas/energizantes/mixers, y los banners de rubros comprables cuando no tienen carrusel propio.

## 4. Datos del local pendientes de publicar

Inventariados por el propio repo (`remaining-external-data.md`) y visibles hoy como "a confirmar" en el Perfil del cliente:

- Horarios de atención.
- Zona de cobertura de delivery.
- WhatsApp del comercio (requiere registro autorizado vía RPC; sin él, la tarjeta de ayuda del seguimiento queda oculta).
- Medios de pago definitivos (hoy: "a coordinar con el local").
- Confirmación de retiro en local.
- Tarifa de envío y pedido mínimo definitivos (demo usa $1.990 / $5.000 como semilla).
- Catálogo verificado: precios vigentes, stock inicial, política de disponibilidad e imágenes oficiales con derechos (0 packshots comerciales aprobados a la fecha del cierre).
- Promociones: las 2 candidatas del CSV siguen inactivas, sin precio, vigencia ni aprobación.

## 5. Impacto comercial

- **Descubrimiento**: 3 de cada 4 productos que el cliente ve son vidriera no comprable; la búsqueda "fernet" (emblema de la categoría en Argentina) devuelve solo "Precio próximamente". El tratamiento honesto está bien resuelto; la conversión queda topeada por datos, no por producto.
- **Confianza para pagar**: el perfil "desconfiado" no encuentra horario, teléfono ni medio de pago firme — 5 de 9 filas de "Información del local" dicen "a confirmar/a coordinar". Es el freno más directo a la primera compra real.
- **Palanca**: cada precio que el negocio publique enciende automáticamente su tarjeta comprable, su categoría en la fila de la home y, cuando corresponda, su banner/historia — sin ningún cambio de código adicional (contrato `hasPurchasableDestination`).
