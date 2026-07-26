# Flujo del negocio

## Vista operativa

La pantalla principal prioriza cuatro contadores: Nuevos, En preparación,
Listos y En camino. La cola muestra código, hora, cliente limitado, modalidad,
importe y la acción siguiente. Métricas, reportes, caja, catálogo,
configuración y guía permanecen en secciones separadas, sin convertir la vista
principal en una página única de miles de píxeles.

La autenticación y los roles productivos se preservan. El PIN existe sólo en el
preview privado; producción exige una sesión Supabase y membresía activa del
comercio.

## Recorrido comprobado

1. El cliente confirma el pedido.
2. El negocio lo recibe como nuevo.
3. Acepta el pedido y fija, si corresponde, el tiempo de preparación.
4. Lo avanza a preparación y luego a listo.
5. Puede asignar un rider activo desde un directorio mínimo o dejar que un rider
   autorizado lo tome.
6. La asignación/reasignación usa compare-and-swap sobre estado y rider
   esperados.
7. El negocio ve el progreso operativo y la entrega validada, sin acceder al
   secreto de seguimiento ni al historial GPS completo.

## Controles productivos preservados

- `owner`, `admin` y `staff` son los únicos roles de operación del negocio;
- el directorio de riders retorna sólo UUID operativo y nombre de presentación;
- no existe escritura directa desde navegador a tablas de pedidos, tokens o GPS;
- las transiciones de estado pasan por RPC y bloquean saltos;
- la reasignación se limita a etapas previas al retiro;
- la reserva de stock, el pedido y el handoff se crean de forma atómica e
  idempotente;
- el catálogo productivo sólo se publica por autoridad owner/admin.

## Evidencia

- Capturas `*-08-business.png` en ambos ciclos y seis viewports.
- `videos/business-rider-delivery.webm`.
- Pruebas unitarias de roles, transiciones, asignación y RLS.
- E2E del pedido cliente → negocio → rider → entrega.

La aplicación real de migraciones contra PostgreSQL/Supabase queda fuera de este
host porque no hay runtime autorizado ni herramientas locales disponibles; la
validación incluida es estática y fail-closed.
