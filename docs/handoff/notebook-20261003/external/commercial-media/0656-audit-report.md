# Auditoría de TABA/TABA2 — producción comercial

Fecha de auditoría: 2026-08-28  
Modo de ejecución: ?demo=1, repositorio local, datos sintéticos aislados.

## Instalación seleccionada

- Ruta absoluta: C:\Users\marco\dev\la-taba-business-panel-automation
- Repositorio: https://github.com/bitflowapp/la-taba-pages-preview.git
- Rama: feature/taba-business-panel-automation
- HEAD: 523d3d00bc303c9333f4c2f77aefb2b3b0e24f89
- Commit: feat(panel): una bandeja que dice qué mirar primero, y un pedido que no entra mudo
- Worktree seleccionado: limpio al iniciar la producción.
- Versión de runtime: la-taba-runtime-v92-la-bandeja-dice-que-mirar-primero
- Inventario de assets de esa versión: 137.

Se compararon tres copias relevantes:

1. C:\Users\marco\dev\la-taba-pages-preview: main, HEAD 31c900b7e4d66a89e80c535e59ed30fdad03ea3a, detrás de origin/main por 11 commits y con cambios locales previos.
2. C:\Users\marco\worktrees\taba2-production-candidate: release/taba2-production-candidate, HEAD 317bbe9dc1c987c31ea4e0915784f881f61f24b6, más antigua y con cambios locales previos.
3. La copia seleccionada: feature/taba-business-panel-automation, HEAD 523d3d00bc303c9333f4c2f77aefb2b3b0e24f89, limpia y un commit sobre origin/main.

No se descartó ni se atribuyó ningún cambio preexistente de las otras copias. La aplicación no fue modificada para esta producción.

## Funciones mostradas

- Experiencia de cliente real de La Taba: inicio, catálogo, búsqueda, categorías y productos.
- Ficha de producto con precio, disponibilidad, observación y acción de agregar.
- Carrito y checkout real, incluyendo delivery/retiro y forma de pago disponible.
- Confirmación del pedido y timeline de estados.
- Bandeja del comercio con pedido nuevo, contadores y siguiente acción.
- Transición operativa real: aceptar, preparar y marcar listo.
- Vista rider: entrega disponible, aceptación y salida del local.
- Seguimiento del cliente en En camino, mapa y recorrido de muestra local.

## Funciones excluidas

- Mercado Pago: el estado auditado no lo presenta como flujo operativo listo.
- GPS real, ubicación en vivo o ETA real: el recorrido usado es sintético/local y la interfaz lo declara.
- Código de entrega, foto de comprobante y finalización del reparto: agregan datos y no son necesarios para vender el sistema completo.
- Llamadas, WhatsApp, navegación externa y enlaces de terceros.
- PIN de administración, consola, terminal, logs, debugging e infraestructura.
- Métricas, caja, promociones y configuración: son reales, pero aportan menos valor visual en 40 segundos.
- Fotos de producto con estado de derechos RETAILER_SOLO_REFERENCIA o PENDING_REVIEW. Se conservaron los placeholders que la UI actual usa de forma deliberada.
- Modo ?showcase=1: incluye un panel de guía y disclaimers internos; no es la experiencia comercial final.

## Validación funcional

Los recorridos se ejecutaron desde la UI, no desde almacenamiento ni APIs:

- artifacts/taba2-commercial/runtime/runtime-audit.json
- artifacts/taba2-commercial/operations/operations-audit.json

Ambas auditorías terminaron con errors: []. La captura audiovisual quedó documentada en capture-manifest.json.
