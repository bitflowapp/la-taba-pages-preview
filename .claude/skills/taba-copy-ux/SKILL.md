---
name: taba-copy-ux
description: Microcopy comercial de TABA2 en castellano rioplatense — títulos de sección, tarjetas de producto, CTA, estados vacíos, errores, avisos de +18 y textos de campaña. Usar cuando se escriba o revise cualquier texto que vea un cliente, se pida un nombre para una sección o un botón, o haya que corregir copy que suena genérico, exagerado o inventado.
allowed-tools: Read, Grep, Glob
---

# Microcopy comercial de TABA2

Dueña de **cómo suena la tienda**. No decide qué se muestra ni cuánto cuesta: le
pone palabras a lo que las otras skills ya validaron.

## La voz

Castellano rioplatense, voseo, sin regionalismos forzados. Un local que conoce lo
que vende y no necesita gritar.

Cuatro atributos, en orden de prioridad cuando entran en conflicto:

1. **Claro** — se entiende a la primera, en un teléfono, con una mano.
2. **Corto** — un título es un renglón; una descripción, dos.
3. **Natural** — como lo diría alguien del mostrador, no como lo escribiría un
   sistema.
4. **Premium sin pretensión** — la calidad se muestra en el producto y en la
   foto; el texto no tiene que decir que algo es premium.

Orientado a la acción: cada pieza termina en algo que la persona puede hacer.

## Verbos reales

Los CTA nombran lo que efectivamente pasa: **Ver · Pedir · Agregar · Sumar ·
Repetir · Seguir**.

**"Reservar" está prohibido**, y hay un test que lo protege: no existe reserva en
este storefront, y un botón que promete guardar algo que nadie guarda es una
promesa incumplida en el primer toque.

## Lo que el copy no puede afirmar

Ninguna pieza editorial menciona precio, porcentaje, oferta, descuento,
liquidación, gratis, promoción ni rebaja. Esos números tienen dueño
(`taba-pricing-promotions`) y su propio camino a pantalla; en el copy suelto son
una promesa sin respaldo.

Tampoco se afirma lo que no está medido:

- "el más vendido", "el favorito de todos", "elegido por…" — sin dato, es
  invención;
- "últimas unidades", "por tiempo limitado", "se agota" — urgencia falsa;
- "el mejor precio", "imperdible", "no te lo pierdas" — publicidad de nadie;
- lenguaje de casino: "ganá", "sorteo", "premio", "tu suerte", cuentas regresivas.

Si el dato existe y está medido, se dice con su alcance: "el más pedido este mes"
sólo si alguien puede mostrar el mes y el conteo.

## Cómo suena bien

| En vez de | Escribir |
|---|---|
| "¡Aprovechá esta oferta única!" | "Seis latas bien frías para arrancar" |
| "Producto no disponible temporalmente" | "Ahora no lo tenemos" |
| "Error al procesar su solicitud" | "No pudimos tomar el pedido. Probá de nuevo" |
| "Complete los campos obligatorios" | "Falta la dirección para poder entregar" |
| "0 resultados encontrados" | "No encontramos nada con eso. Probá con la marca" |
| "Añadir al carrito" | "Agregar" |

Más patrones por superficie —estado vacío, error, +18, recompra, combo,
pendiente— en [references/patrones-de-copy.md](references/patrones-de-copy.md).

## Estados difíciles, que son los que definen la marca

- **Producto sin precio**: se dice que todavía no está disponible para compra.
  No se esconde el producto —estar en el catálogo documenta el surtido— pero
  tampoco se insinúa que se puede comprar.
- **Sin stock**: "Ahora no lo tenemos" es honesto y corto. "Agotado" está bien;
  "vuelve pronto" sólo si alguien sabe que vuelve.
- **Fuera de zona u horario**: decir cuándo o dónde sí, en el mismo mensaje.
- **+18**: el aviso es informativo y sin culpa. Se pide confirmación de mayoría
  de edad; no se pide documento ni se insinúa que se va a guardar algo.

## Antes de dar por buena una pieza

1. ¿Afirma algo que alguien pueda desmentir con un dato?
2. ¿El CTA describe lo que realmente pasa al tocarlo?
3. ¿Se entiende sin el contexto de la pantalla anterior?
4. ¿Entra en un renglón en pantalla chica?
5. ¿Lo diría una persona del local, en voz alta, sin sonar a folleto?

Una pieza que falla en la 1 se corrige o se borra. Las otras se pulen.

## Nunca

- Prometer algo que el sistema no hace.
- Inventar urgencia, escasez o popularidad.
- Usar signos de exclamación en cadena, mayúsculas sostenidas ni emojis en el
  copy comercial.
- Traducir literal del inglés ("Añadir al carrito", "Checkout seguro").
- Decir el precio en un texto editorial.
