# Auditoría visual y de producto · TABA Ultra

Fecha: 25 de julio de 2026
Rama auditada: `feat/taba-production-beverages`
Checkpoint previo: `dc587ca chore: checkpoint beverage storefront simplification`

## Alcance y referencias

Se revisaron la home, catálogo, detalle de producto, carrito/checkout, tracking,
panel de negocio, panel rider, navegación móvil y responsive. La Foto 1 se tomó
como dirección para storefront, jerarquía comercial y recompra; la Foto 2 para
tracking, timeline, mapa y ayuda. Las referencias no se usan como assets ni se
copian literalmente.

## Diagnóstico ejecutivo

La base ya separa preview, demo y producción; protege roles y falla cerrado ante
un runtime productivo incompleto. El storefront previo también incorporó las
categorías de bebidas y el checkout condiciona correctamente la mayoría de edad.
Sin embargo, la experiencia todavía combina capas visuales heredadas, contenido
de demostración y algunos contratos productivos desconectados.

Los problemas prioritarios son:

1. La home no monta el componente de recompra aunque la lógica existe.
2. El banner de promos es estático y puede prometer una oferta inexistente.
3. El tracking productivo deriva a una confirmación de muestra y desactiva el
   mapa incluso con GPS real.
4. El DTO público seguro y su mapper no comparten la misma forma.
5. Los IDs de categorías no son canónicos entre fixtures y Supabase.
6. La edición local no infiere alcohol por categoría, por lo que podría omitir
   la validación de edad.
7. Persisten código, plantillas, caché y fixtures de pizzería/carnicería.
8. El lenguaje crema/serif, los paneles anidados y el modal oscuro alejan el
   producto del quick-commerce blanco, rojo y grafito de las referencias.

## Auditoría por superficie

| Superficie | Estado actual | Riesgo o fricción | Dirección |
| --- | --- | --- | --- |
| Home | Estado, dirección, búsqueda, categorías, promo y destacados | Sin H1 visible; categorías 3×2 muy altas; promo estática; recompra ausente | Wordmark claro, propuesta compacta, categorías horizontales, promo real, destacados y “Volver a pedir” |
| Catálogo | Buscador, filtros, orden y grilla completa | Placeholder repetido; categorías mezclan IDs; tarjetas altas; fondo crema | Dos columnas móviles, cards blancas compactas, disponibilidad breve y CTA roja |
| Detalle | Modal funcional con precio, presentación y stock | Modal oscuro; muestra “Preparación” técnica; demasiadas filas y botones | Sheet blanco con imagen, nombre, presentación, precio, disponibilidad, alcohol y agregar |
| Carrito | Cantidades y resumen correctos | Acciones secundarias dominan; varias cajas anidadas | Lista compacta, total legible y transición directa al checkout |
| Checkout | Validación, delivery/retiro y edad condicional correctos | Copys técnicos, pago presentado como panel, bottom nav sobre campos | Campos mínimos, forma de pago explícita, indicaciones plegadas y confirmación dominante |
| Tracking | Estados, código y detalle disponibles | Seis conceptos visibles, métricas pesadas, sin mapa real, rider humanizado | Cuatro macro-pasos, ETA honesta, mapa solo con GPS real, delivery neutro, ayuda y resumen breve |
| Negocio | Cola, filtros, estados, reportes, catálogo y configuración | Primer nivel muy largo; glifo/textos de pizzería; demasiada competencia visual | Mantener arquitectura, priorizar cola y acción siguiente, plegar secundarios |
| Rider | Pedido asignado y avance operativo claros | Mapa forzado a apagado; varios bloques secundarios visibles | Una entrega y una acción primaria; GPS honesto; foto/código/detalle secundarios |
| Navegación | Desktop y bottom nav funcionales | Bottom nav puede tapar checkout; CTA y nav compiten | Navegación ligera; ocultarla durante checkout/tracking; respetar safe areas |

## Hallazgos técnicos que afectan la UI real

### Tracking fail-closed

- `js/ui.js` fuerza `liveRider = false` y manda cualquier modo no demo a
  `renderPublicPreviewTracking()`.
- `js/delivery.js` fuerza `gpsLive = false`.
- Ya existe `hasLiveRiderLocation()`, que acepta únicamente GPS real, válido y
  reciente. Debe ser la única condición que habilite mapa y marcador.
- La RPC pública devuelve `public_code` y `rider_location`; el mapper exige
  `id` y lee `rider_locations`. El polling por token puede devolver `null`.
- La corrección debe preservar detalles locales y mezclar únicamente estado,
  timestamps y ubicación minimizada. Nunca debe inventar PII, ruta, distancia,
  dirección ni ETA.

### Categorías y alcohol

Los slugs productivos derivados del nombre usan:

- `vinos-y-espumantes`
- `gins-y-vodkas`
- `whisky-y-destilados`
- `picadas-y-deli`
- `hielo-y-extras`

Los fixtures usan variantes sin `-y-`. Esto puede ocultar o reordenar categorías
cuando se carga Supabase. También se debe inferir `alcoholic: true` y
`minimumAge: 18` al crear o normalizar productos de categorías alcohólicas.

### Recompra y promos

- `renderDirectOrderingCustomerActions()` existe, pero `index.html` no contiene
  `data-customer-actions`.
- `renderPromoBanner()` existe, pero el banner perdió `data-promo-banner`.
- La home debe ocultar una promo sin producto real disponible y montar recompra
  después de los destacados.

### Remanentes de rubros anteriores

- `js/data.js` conserva el catálogo histórico de pizza.
- `sw.js` todavía precachea fotos de pizza/horno.
- `templates/la-taba-products-template.csv` contiene carnes y parrilla.
- El fallback de producto usa `beef`/`thumb-steak`.
- Negocio todavía muestra un glifo de pizza y textos como “Menú y promos” o
  “cocina”.
- Algunas pruebas usan Muzzarella, hamburguesa, asado o estados de carnicería.

## Sistema visual propuesto

| Token | Valor |
| --- | --- |
| Rojo TABA | `#d71920` |
| Rojo oscuro | `#b31217` |
| Negro | `#111111` |
| Grafito | `#2b2b2b` |
| Texto secundario | `#6b6b6b` |
| Borde | `#e7e7e7` |
| Fondo suave | `#f6f6f6` |
| Blanco | `#ffffff` |
| Rojo suave | `#fff1f2` |
| Estado abierto | `#199a55` |

Se usará la pila sans serif existente, radios de 12–18 px, sombras breves y el
rojo como único acento fuerte. Se eliminan del storefront el serif, el cobre,
los gradientes cálidos repetidos y las superficies oscuras del detalle.

## Decisiones derivadas de la Foto 1

- Marca y estado se comprenden antes de cualquier promoción.
- Dirección y búsqueda quedan arriba del primer scroll.
- Categorías se recorren horizontalmente y no ocupan dos filas altas.
- Solo una promo roja, condicionada a catálogo y stock reales.
- Destacados compactos con producto, precio y una acción inequívoca.
- Recompra inmediatamente después de destacados.
- CTA móvil fija `Ver pedido · $TOTAL`, por encima de la navegación.

## Decisiones derivadas de la Foto 2

- Título contextual fuerte: confirmado, preparando, en camino o entregado.
- Timeline público de cuatro macro-pasos, sin alterar los estados internos.
- ETA real o `A confirmar`; nunca un número simulado.
- Mapa claro únicamente cuando existe GPS real reciente.
- Marcador de delivery neutro; sin persona, rating, viajes o teléfono inventado.
- CTA de ayuda que lleva a un canal verificado o a los datos del local.
- Resumen breve del pedido sin paneles técnicos ni métricas irrelevantes.

## Criterios de aceptación visual

- Sin overflow horizontal en 320, 360, 390, 412, 768 y 1280 px.
- Objetivos táctiles de al menos 44×44 px.
- Header, bottom nav y CTA sin superposición.
- Checkout sin navegación fija sobre los campos.
- Tarjetas sin nombres cortados ni botones fuera de pantalla.
- Mapa ausente ante GPS simulado, vencido o inexistente.
- Mapa y marcador neutro presentes ante GPS real, válido y reciente.
- Ninguna referencia activa a pizza, pizzería, parrilla o carnicería en la
  experiencia, fixtures, plantillas o pruebas del producto.

## Fuera de alcance seguro de esta fase

La selección nominal de un rider desde negocio requiere perfiles vinculados a
`auth.users`, listado autorizado y una RPC atómica/auditable. No se debe
simular. El cierre seguro posible es una cola minimizada y autoasignación del
rider; cualquier ampliación se documentará sin relajar RLS.
