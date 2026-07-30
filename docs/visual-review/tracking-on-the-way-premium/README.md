# Tracking `on_the_way` — pulido visual premium

Rama `feature/tracking-onthe-way-premium-visual`, sobre `63a7cf3`.

Ajuste fino **sólo de composición y estilo** del estado público `on_the_way`
(y de su equivalente interno `picked_up`, que el cliente lee con el mismo
título y el mismo paso de progreso). No cambian los datos, los estados, el
flujo, las reglas de honestidad del ETA ni el control de acceso a la ubicación
del rider.

El estado `arriving` ya certificado no se toca: todo el bloque nuevo está
acotado con `:is(.status-on_the_way, .status-picked_up)`.

| Captura | Qué muestra |
| --- | --- |
| `01-before-390x844.png` | Estado anterior en el dispositivo de referencia |
| `02-after-390x844.png` | Estado resultante |
| `03-after-320x568.png` | Ancho mínimo soportado |
| `04-after-no-map-390x844.png` | Mismo estado sin ubicación disponible |
| `05-arriving-reference-390x844.png` | `arriving` certificado, sin cambios (referencia de lenguaje) |

## Auditoría previa (medida, no estimada)

Consistencia contra el lenguaje ya certificado en `arriving`:

1. Marca `TABA` en peso 950 contra 750 con `-0.08em`; barra superior de 64px
   contra 57px.
2. Botón de menú a 8px/derecha 18px contra 3px/derecha 6px, e ícono de 29px
   contra 26px.
3. Titular en 27,3px peso 850 casi negro contra 29px peso 600 en grafito.
4. Bajada en 18px contra 16px, y sello de actualización en 13,5px contra 12,5px.
5. Línea de progreso con puntos de 22px, rieles de 2px y etiquetas en peso 550,
   contra puntos de 18px, riel continuo de 1,5px y etiquetas en peso 400.
6. Tarjetas con radio 22px y sombras `0 6px 18px`, contra radio 19–20px y
   `--shadow-xs`.
7. Tarjeta del rider con columna de 62px y contacto sólido, contra 50px y
   contacto fantasma.
8. Resumen del pedido de 92px de alto contra 68px.

Defectos propios del estado:

9. **Pin de destino recortado por el borde superior del mapa**: `fitBounds`
   usaba 34px de padding uniforme y los pines miden 54px anclados por la punta.
10. **La estimación de la sandbox tapaba el control de atribución de MapLibre**
    (superposición medida de 29×27px en 390×844).
11. Mapa a saturación plena: las etiquetas y escudos del mapa base competían
    con el recorrido rojo y con el casco.
12. Estimación en 13px peso 850, el texto más pesado de toda la superficie.
13. A 320px la tarjeta del rider crecía a 140px porque el contacto se iba a una
    fila propia, mientras `arriving` la mantiene compacta al mismo ancho.
14. El titular rompía en dos líneas a 320px.
15. La bajada trataba igual un ETA confiable que el texto de espera
    "Calculando llegada".
16. Local, rider y recentrado se amontonaban en la esquina inferior derecha,
    con el pin del local dibujado por encima del casco.

## Cambios

**`styles/tracking.css`** — bloque nuevo acotado a `on_the_way`/`picked_up`
que adopta el lenguaje de `arriving` en barra superior, titular, bajada, línea
de progreso, mapa, tarjetas, resumen y pie, y además:

- El titular escala con `clamp(25.5px, 7.35vw, 29px)` para sostener una sola
  línea desde 320px.
- La bajada baja de jerarquía cuando no hay ETA confiable
  (`[data-eta-active="false"]`) y el número es el ancla cuando sí lo hay.
- El mapa toma el alto que libera la ausencia de la tarjeta de código:
  `clamp(300px, 87vw, 356px)`.
- Base del mapa calmada con el mismo filtro certificado en `arriving`, para que
  el recorrido y el casco sean lo único saturado del encuadre.
- El punto de "en vivo" late sólo con ubicación fresca, y se detiene con
  `prefers-reduced-motion`.
- La estimación de la sandbox se apila sobre la atribución en vez de taparla.
- El casco queda por encima de los pines de lugar; el destino comparte el rojo
  tokenizado y el local se atenúa porque ya quedó atrás en el viaje.
- La variante sin mapa conserva el mismo ritmo.

**`styles/responsive.css`** — equivalentes a ≤820px y ≤360px, incluida la
tarjeta del rider compacta a 320px, con la misma paridad de pie que `arriving`.

**`js/map/maplibre_tracking_map.js`** — `fitSandboxGeometry` reserva el alto
real de los pines y del cromo superpuesto, proporcional al contenedor para que
sirva igual en la vista cliente y en la del rider. Sin contenedor medible
conserva el valor anterior.

## Resultado medido (390×844)

| Métrica | Antes | Después |
| --- | --- | --- |
| Titular | 27,3px / 850 | 28,7px / 600 |
| Alto del mapa | 320px | 339px |
| Tarjeta del rider | 83px | 80px |
| Resumen | 94px | 70px |
| Pie de ayuda (borde inferior) | 820,3px | 791,5px |
| Estimación vs. atribución | superpuestas | 7px de separación |

A 320px el titular pasa de dos líneas a una (58,3px → 27,5px de alto) y la
tarjeta del rider de 140px a 120px.

## Fuera de alcance

El documento de la vista mide 917px de alto en 390×844 por `main { min-height:
100vh }`, que es común a toda la vista de seguimiento: el `arriving` certificado
mide exactamente lo mismo. No se tocó, porque cambiarlo alteraría una superficie
ya certificada. El criterio certificado —que el pie entre en pantalla— se
cumple con holgura (791,5px contra 844px).

A 320px el casco puede quedar por debajo del botón de recentrado cuando el
rider está sobre esa esquina. Es el comportamiento normal de un control fijo
sobre un mapa: el marcador no se recorta y el control sigue legible.
