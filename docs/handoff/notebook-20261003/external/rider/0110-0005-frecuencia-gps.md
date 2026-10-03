# ADR-0005: Frecuencia de captura y publicación

- Estado: aceptado como valor inicial, sujeto a medición física.
- Decisión: objetivo 7,5 s y 20 m; rango configurable 5–15 s; jamás publicar antes de 5 s; en `arrived` no bajar de 5 s. Provider puede entregar fixes más frecuentes, pero el publisher filtra.
- Alternativas: 1 s continuo; 30 s fijo; confiar sólo en distancia.
- Motivo: Gate 2 aplica mínimo 5 s y la UI histórica usa freshness de 15/45 s. 7,5 s equilibra batería y vivacidad.
- Consecuencia: se pueden perder puntos intermedios; no se fabrican ni se reenvían fuera de ventana.

