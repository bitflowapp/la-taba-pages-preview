# Performance review TABA2

- Presupuesto de movimiento: transform/opacity; ninguna transición comercial supera 420 ms.
- Observers: un IntersectionObserver compartido y un MutationObserver compartido; ambos se desmontan con destroy().
- Degradación: prefers-reduced-motion, saveData, red 2G/slow-2G y memoria baja reducen o eliminan efectos opcionales.
- Scroll: sólo un listener pasivo con requestAnimationFrame para el estado sticky; no se animan width/height/top/left.
- Skeleton: shimmer acotado a estados de carga reales; spinner sólo durante envío de checkout.
- Overflow horizontal en capturas: ninguno.
- Long tasks reportadas por PerformanceObserver: 0.
