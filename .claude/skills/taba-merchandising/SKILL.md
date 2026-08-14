---
name: taba-merchandising
description: Decide qué pieza comercial va en cada superficie del storefront TABA2 — hero, puertas/banners, orden de secciones, pieza en grilla, cross-sell del carrito, combos y packs. Usar cuando se pida destacar algo, armar una campaña, cambiar el orden de la home, sugerir productos complementarios, revisar la personalización o el ranking, o entender por qué el motor eligió lo que eligió.
allowed-tools: Read, Grep, Glob
---

# Merchandising y personalización de TABA2

Dueña de **dónde y cuándo se muestra** una pieza comercial. No decide qué se
vende ni a qué precio (`taba-pricing-promotions`), no crea productos
(`taba-catalog-management`) y no escribe el texto (`taba-copy-ux`).

## El principio que ordena el surtido

**La intención primaria va primero; los complementos después.**

Alguien que muestra intención de cerveza quiere cerveza. Se le muestra cerveza:
más marcas, más estilos, más presentaciones. Recién después aparece lo que
completa esa compra —hielo—, y nunca en lugar de lo que pidió.

Cerveza → cerveza → hielo. **No** cerveza → energizante porque "combina".

El grafo de complementos es por categoría y está en `js/growth/complements.js`:
`fernet → gaseosas, mixers, hielo` · `destilados → mixers, hielo, energizantes`
· `cervezas → hielo`. Una categoría que ya está en el carrito deja de ser
complemento: si ya hay hielo, el hielo no es un faltante.

**Desde un carrito con alcohol nunca se recomienda más alcohol.** No es una
preferencia de diseño; es la línea que separa recomendar de empujar.

## El motor elige entre piezas válidas: no las inventa

Toda superficie es fail-closed en cadena. Una pieza se descarta si está
deshabilitada, si está fuera de vigencia, si su **destino no tiene producto
comprable ahora**, o si promete una promoción que no está validada como activa.

Un banner que lleva a una categoría vacía es un link muerto con estética de
oferta. Antes de proponer cualquier pieza, verificar que el destino existe y se
puede comprar hoy.

Si el motor entero muere, cada superficie pinta lo que pintaba antes. El
fallback **es** la vidriera auditada, y esa es la garantía que permite tocar el
ranking sin miedo.

## Cold start

Perfil vacío → manda la prioridad comercial, no una elección aleatoria. Un
usuario nuevo ve la vidriera actual: destacados y variedad general. Los empates
exactos rotan por día calendario, sin `Math.random`.

## Superficies y reglas

| Superficie | Regla corta |
|---|---|
| Hero contextual | 1 pieza; la por defecto conserva su banda y su preload |
| Puertas rankeadas | hasta 3; nunca un rubro que ya tiene carrusel en pantalla |
| Orden de secciones | sólo con afinidad ≥ umbral; suben antes del corte |
| Pieza en grilla | 1 sola, tras la 4ª tarjeta; nunca en búsqueda ni grilla corta |
| Cross-sell del carrito | reglas propias ya auditadas; no se duplican acá |
| Recompra | dueña: `taba-reorder-retention` |

El detalle de señales, pesos, decay, diversidad, frequency cap y explicabilidad
está en [references/ranking-y-superficies.md](references/ranking-y-superficies.md).

## Estabilidad: no mover piezas bajo el dedo

Las selecciones se congelan por **época de vista**. Entrar a una vista o cambiar
de categoría abre una época nueva; dentro de una época, ni las señales en vivo ni
un re-render del carrito reordenan nada. La intención acumulada manda en la
**próxima** entrada.

Toda pieza reserva altura por CSS y existe desde el primer render. Una superficie
que aparece después empuja el contenido y hace que alguien toque lo que no quería.

## Secciones vacías

No se muestra una sección que no se puede llenar con material válido. Si no hay
packs minoristas aprobados suficientes, **no hay sección de packs** — no se
completa con lo que sobra ni se baja el umbral para que entre algo.

## Campañas

El esquema de campaña (id, vigencia, placements, destino, prioridad, contextos,
creatividad, `requiresIntent`) es además el **contrato del panel futuro** de
Walter. Tres tipos, con honestidad distinta:

- `editorial`: puerta con ganas. Su copy no puede mencionar precio, porcentaje,
  oferta, descuento ni gratis.
- `combo`: el único dinero que muestra es el derivado del catálogo vivo. Si el
  combo deja de ser cobrable, la pieza deja de existir.
- `promotion`: sólo si la promoción está validada como activa. Sin eso, la pieza
  no se muestra, aunque su prioridad sea máxima.

Las creatividades salen del lote curado con procedencia registrada. No se genera
una imagen de marca para una campaña.

## Qué entregar

1. Qué pieza, en qué superficie, con qué destino y por qué gana.
2. La verificación de que el destino tiene producto comprable **hoy**.
3. Si la propuesta necesita una promo o un precio que no existe: derivar a
   `taba-pricing-promotions` y detenerse. Merchandising no crea dinero.

## Nunca

- Recomendar alcohol como complemento de alcohol.
- Ampliar la exposición de alcohol más allá de lo que la góndola ya muestra, ni
  segmentar por edad: no existe señal de edad y no se va a construir una.
- Mostrar una pieza cuyo destino no tiene nada comprable.
- Reordenar la vista mientras la persona está mirándola.
- Usar una promoción no validada como criterio de ranking.
