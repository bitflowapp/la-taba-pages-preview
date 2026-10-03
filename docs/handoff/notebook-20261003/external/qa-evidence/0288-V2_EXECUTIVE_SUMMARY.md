# TABA v2 — Resumen ejecutivo

**Fecha:** 2026-07-31 · **Base:** `2026-07-31/` (dirección "Mostrador Patagónico", aprobada)
**Naturaleza:** propuesta cerrada y validada. **Nada está implementado.**

## Qué es esta versión

Una corrección focal. **No se rediseñó nada aprobado y los tokens tienen cero diff contra la v1.** La v2 cierra los huecos que impedían llamar "lista para implementación" a la propuesta.

> **Nota de alcance.** El encargo llegó truncado: termina en el árbol de directorios y no incluye la lista explícita de puntos no aprobados. El alcance se derivó de lo que el propio encargo aprueba —donde dos entradas dicen "**arquitectura**" y no "ejecución"— y de lo que la v1 dejó abierto. Está justificado en `V2_DECISIONS.md §0`. El trabajo está aislado: revertir un foco no arrastra a los demás.

## Los cuatro focos

**1 · El flujo de compra no existía.** La navegación prometía "Ver pedido" y no había pantalla. Peor: el cambio de **mayor riesgo comercial** de todo el plan —`.checkout-form .button-row`, que depende de la reserva de P0-01— nunca se había validado con el teclado abierto, porque no había checkout que validar.

Ahora hay un prototipo completo: carrito, checkout de una sola página con las direcciones del Perfil, cálculo de vuelto, y confirmación con código de entrega. **Validado con teclado abierto: 0 elementos tapados.**

**2 · En tablet no se podía abrir un pedido.** La especificación del negocio desktop decía "el detalle pasa a hoja lateral"; el prototipo tenía `display: none`. A 768px el operador elegía un pedido y no pasaba nada. Ahora la hoja entra deslizando, se cierra con botón y con `Escape`, y devuelve el foco.

**3 · Al rider le faltaban 5 de sus 25 flujos.** Sesión expirada, cancelación del local, cliente ausente, historial y perfil. Las tres pantallas de interrupción ahora dedican un bloque explícito a **qué pasó con lo que el rider ya hizo** — sin eso, la cola durable no genera confianza. Y el mapa dibuja una ruta en lugar de una trama.

**4 · Defectos medidos pendientes.** El precio quedaba a distinta altura entre tarjetas contiguas según la presentación ocupara una o dos líneas; se ancló el pie de la tarjeta. Y los dos "Speed Unlimited" idénticos ahora exponen la variante que **ya estaba en el identificador del producto**.

## Estado de validación

| | Resultado |
|---|---|
| Capturas | **24 / 24 sin hallazgos** |
| Errores de consola · desbordamiento · objetivos <44px · campos <16px · contenido tapado | **0 · 0 · 0 · 0 · 0** |
| Validación estructural y de accesibilidad | **8 / 8 vistas limpias** |
| Checkout con teclado abierto (390×420) | **0 elementos tapados** |
| Interacción verificada (no sólo capturada) | 7 flujos |

## El hallazgo que hay que llevarse

Construyendo esta v2 **volví a cometer el mismo error de orden de cascada que la v1 había documentado como riesgo R6**: reglas `@media` escritas antes de su definición base, que con la misma especificidad pierden por orden de fuente. El resultado fue que la barra de "volver" de la hoja de tablet no se renderizaba y el operador quedaba atrapado en el detalle.

No produce error, ni advertencia, ni solape. Sólo hace que un control no aparezca.

**Conclusión operativa:** el orden "base antes que `@media`" tiene que ser una **regla de lint que rompa el build**, no una convención documentada. Está en el handoff como requisito de la etapa 8.

Y un corolario: de los siete defectos que la v2 encontró en sí misma, **dos sólo aparecieron al ejercitar la interacción** — sus capturas salían perfectas. La regresión visual no basta; por eso el handoff separa una etapa de pruebas de interacción.

## Entregables

```
2026-07-31-v2/
├── V2_EXECUTIVE_SUMMARY.md      este documento
├── V2_DECISIONS.md              alcance derivado + 11 decisiones de diseño
├── V2_CHANGELOG.md              delta exacto contra la v1
├── V2_IMPLEMENTATION_HANDOFF.md 2 etapas nuevas, 2 commits nuevos, mapa de archivos
├── V2_VALIDATION.md             resultados + los 7 defectos hallados en la v2
├── prototypes/                  1 prototipo nuevo + 3 actualizados + CSS compartido
│                                (catálogo desktop y negocio móvil siguen vigentes en v1)
├── screenshots/                 24 capturas
├── design-system/               tokens — idénticos a la v1
├── assets/                      22 packshots reales
└── diagnostics/                 scripts + resultados JSON
```

## Qué sigue necesitando una persona

1. **Prueba física en iPhone y Android con teclado abierto.** El proxy de 390×420 es geométrico: no reproduce `visualViewport` ni `safe-area-inset-bottom`.
2. **Nombre comercial de las variantes Speed.** La regla técnica (unicidad de `(nombre, presentación)`) es independiente del rótulo.
3. **Si el checkout pide el vuelto.** Se quita sin tocar nada más.
4. **Tiempo de espera del protocolo de cliente ausente** — 5 minutos es una propuesta, no un dato del negocio.

## Qué queda fuera

**Perfil y Seguimiento del cliente siguen sin prototipar.** La navegación inferior los ofrece. La v2 priorizó carrito y checkout porque son el camino del dinero. Es el hueco conocido más grande que queda.

Tampoco se creó el proyecto Flutter, ni se implementó nada en el repositorio.

## Repositorio

`C:\1212\la-taba-catalog-checkout-premium` **no fue modificado**. HEAD sigue en `4197bdb`, rama `feature/catalog-checkout-premium`, con los mismos 33 archivos modificados y 6 sin seguimiento que antes de empezar. Sin commits, push, merge ni deploy.
