# Ranking, señales y superficies

Implementación: `js/growth/` (13 módulos). Documento del motor:
`docs/commerce-personalization.md`. **Todos los números ajustables viven en
`js/growth/growth-config.js`** — leerlos de ahí, no de acá, y no copiarlos a
ninguna skill.

## Señales

El bridge observa el estado y el DOM sin tocar handlers existentes: diffs de
estado y listeners pasivos propios. Las señales que existen hoy:

`category_view` · `search_match` · `product_view` · `add_to_cart` ·
`remove_from_cart` · `purchase` · `promo_click` · `promo_dismiss`

Cada señal bumpea hasta tres claves: **categoría, marca y producto**. La query de
búsqueda **no se guarda**: sólo las categorías y la marca que matcheó contra el
catálogo real. Los pesos relativos están en `growth-config.js`; lo que importa
del diseño es el orden: comprar pesa más que agregar, agregar más que mirar, y
sacar del carrito resta.

## Intención con decay

Dos stores del mismo modelo, `{ score, lastTimestamp }` por clave:

- **Largo plazo** en `localStorage`, semivida larga: lo que suele comprar.
- **Sesión** en `sessionStorage`, semivida corta y peso mayor: lo que busca ahora.

Lectura: `score · 0.5^(Δt/semivida)`. Escritura: decaer y sumar, con tope por
clave para que un tap accidental no domine el perfil. La afinidad final se
normaliza con saturación suave a 0..1. Al persistir se podan las claves de menor
score y las que quedan bajo un epsilon.

La consecuencia de diseño: **el interés se enfría solo**. Nadie queda marcado
para siempre por una búsqueda de hace un mes, y no hace falta un botón de "borrar
mi perfil" para que el sistema olvide.

## Score

```
score = intención + prioridad comercial + complemento + promoción + contexto
      − penalización de frecuencia − repetición de categoría
```

- **Complemento**: la campaña completa lo que ya hay en el carrito. Decae por
  posición en el grafo: el primer complemento sugerido vale más que el tercero.
- **Contexto**: cubos horarios gruesos (mañana/tarde/noche/finde). Es suave a
  propósito: acompaña, no decide.
- **Diversidad**: selección greedy multi-slot. Repetir rubro cuesta caro desde el
  segundo slot — mirar una cerveza no convierte la home en veinte cervezas.
- **Determinismo**: reloj inyectable, sin `Math.random`. Los empates de cold
  start rotan por día calendario.

## Frequency cap

Impresiones gratis al principio; después, cada impresión no correspondida
penaliza. Muchas impresiones sin click excluyen la campaña por un rato; un
descarte explícito la silencia bastante más; cada click perdona impresiones.

Las impresiones son **honestas**: se cuentan con IntersectionObserver al 50%
visible y se deduplican por época de vista. Contar un render como impresión
infla el denominador y hace que una pieza que nadie vio parezca ignorada.

## Explicabilidad

Cada selección lleva su `explain` por factor. Con el flag de debug se puede
imprimir por superficie. **Nunca es visible para el cliente**: explicar el
ranking en la tarjeta no es transparencia, es ruido.

Si una propuesta de merchandising no se puede explicar factor por factor, no está
lista para proponerse.

## Diversidad por presentación

La diversidad no es sólo por categoría: diferencia marca, categoría y
presentación (lata/botella, unidad/pack cuando exista). Tres latas de la misma
marca en tres slots son una sola idea repetida.

## Búsqueda

El match es por término, contra el texto concatenado del producto (marca, nombre,
variedad, presentación, capacidad, subcategoría, categoría y `tags`). El orden
final aplica relevancia: **nombre o marca exactos ganan** sobre una coincidencia
sólo por categoría.

Un término sin resultados es información: un hueco de surtido documentado. No se
"arregla" agregando tags a un producto que no es lo que se buscó.

## Privacidad

Se persisten agregados por clave con su timestamp, nunca eventos crudos ni datos
personales. Todo local al navegador: sin fingerprinting y sin identificación
entre dispositivos. Un estado corrupto se descarta y el motor arranca frío; la
tienda ni se entera.

Cross-device requeriría una tabla con RLS por dueño sincronizando **los mismos
agregados compactos**. Está diseñado, no construido, y no se construye por
decisión lateral.
