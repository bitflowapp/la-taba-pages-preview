# Matriz de aceptación comercial

Fecha de cierre local: 25 de julio de 2026.

| Gate | Resultado | Evidencia |
| --- | --- | --- |
| 0. Seguridad y checkpoint | PASS | Ruta `C:\1212\la-taba-pages`, rama `feat/taba-production-beverages`, checkpoint `6a34cd6`, sin push ni deploy. Baseline técnico y audit de dependencias aprobados. |
| 1. Experiencia cliente | PASS | Home mobile-first, búsqueda sincronizada, categorías, promo, destacados, recompra condicional, producto, una CTA móvil de pedido y checkout corto. Estados vacíos/error/cerrado/agotado cubiertos. |
| 2. Catálogo comercial | PASS para preview privada | Doce categorías canónicas, modelo completo, importación validada, autoridad de publicación, placeholder neutro y pipeline WebP/hash. Producción permanece bloqueada sin catálogo, precio, stock e imagen oficiales. |
| 3. Tracking honesto | PASS | Cuatro pasos públicos, mapa sólo con GPS válido y fresco, moto SVG neutral, sin ruta ni ETA inventadas, contacto sólo con canal verificado y DTO público minimizado. |
| 4. Negocio y rider | PASS | Bandeja enfocada en Nuevos/Preparando/Listos/En camino; rider con revelado progresivo, CAS de asignación, GPS ligado al pedido, código de entrega y revocación al cerrar. |
| 5. CSS mantenible | PASS | Tokens y estilos separados en common, storefront, catálogo, checkout, tracking, negocio, rider y responsive; `styles.css` queda como punto de importación. |
| 6. Revisión multiagente | PASS | UX/comercial/responsive: 0 P0/P1/P2. Tracking/seguridad y catálogo/assets: 0 P0/P1/P2 tras correcciones. Revisor final independiente: sin defectos resolubles de severidad P0–P2. |
| 7. QA visual | PASS | Dos rondas completas, 84/84 capturas aprobadas por ronda, en 320×700, 360×800, 390×844, 412×915, 768×1024 y 1280×900. Revisión humana posterior a la ronda 2 sin overflow, cortes ni jerarquías rechazables. |
| 8. Pruebas | PASS local | 444/444 unitarias y 53/53 E2E; check, audit high, migraciones, catálogo, assets y diff aprobados. Los smoke tests contra Supabase/staging no se falsearon: requieren runtime y credenciales autorizadas. |
| 9. Commit local | PASS | Implementación y evidencia guardadas en commits locales coherentes. Working tree limpio respecto de esta misión; permanecen fuera de alcance artefactos históricos no rastreados. Sin push. |

`modified-files.txt` contiene el cambio neto completo desde
`dc587ca3a3a56e043a5843a60022251c40241df3`, por lo que incluye tanto el
checkpoint visual como el cierre comercial de esta entrega.

## Criterios críticos

- Producción no cae a preview y continúa fail-closed.
- El preview comercial exige `demo=1`, no envía pedidos reales y no expone su identidad interna al cliente.
- La edad sólo se confirma cuando el carrito contiene alcohol.
- Ningún producto visible usa un packshot aproximado: se usa imagen exacta aprobada o el placeholder neutral.
- El mapa desaparece sin GPS confiable; la línea de ruta no se inventa.
- La ETA se muestra únicamente con fuente, cálculo y vencimiento válidos.
- Antes de aceptar, el rider no ve nombre, teléfono ni dirección exacta.
- La doble asignación se previene con compare-and-swap y el acceso se revoca al reasignar o entregar.

## Veredicto de esta matriz

El alcance implementado es **listo para preview privada**. No se declara listo
para staging hasta recibir el catálogo comercial aprobado, imágenes oficiales,
datos operativos y un Supabase autorizado donde aplicar y smoke-testear las
migraciones.
