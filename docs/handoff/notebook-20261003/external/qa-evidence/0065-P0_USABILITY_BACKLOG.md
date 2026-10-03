# La Taba — Backlog de usabilidad operativa

Ordenado por riesgo de dinero, pedido, entrega, fiscal y continuidad. No incluye
cambios de storefront/branding que pertenecen al trabajo de Claude.

## P0

| ID | Problema | Superficie / evidencia | Propuesta de producto | Criterio de aceptación | Dependencia |
|---|---|---|---|---|---|
| P0-01 | No existe una apertura de jornada guiada | `js/business/business-operations-center.js:941-1100` concentra métricas, alertas y cierre, pero no preflight ni “Abrir negocio”. | Crear una preflight única con estados y bloqueo por tramo; primer CTA: “Revisar apertura”. | Walter sabe en menos de 2 min qué está listo, qué bloquea y quién lo resuelve; no debe visitar más de una superficie por bloqueo. | Decisión de alcance operativo y fuente de health checks |
| P0-02 | Pago incierto puede inducir repetición | `js/payments/mercadopago-return.js:27-50`; docs MP indican que el retorno no es autoridad. | Diseñar estado de dinero como incidente de primera clase: “no repetir”, ID, pedido asociado, consulta, responsable y cierre. | En pruebas, nadie vuelve a pagar ni crea pedido paralelo ante timeout/aprobado sin pedido. | Contratos MP/operaciones ya existentes |
| P0-03 | Fiscal/ARCA no traduce gates técnicos | `js/business/business-operations-center.js:1112-1114` imprime estados de perfil; ARCA readiness usa `ACCOUNTANT_POLICY_APPROVAL_PENDING` y worker privado. | Mostrar “Qué significa / Podés seguir / Responsable / Próximo paso”; conservar código técnico sólo en detalle soporte. | Owner/empleado identifica si puede vender, emitir o imprimir sin conocer ARCA interno. | Política contable y aprobación de responsable fiscal |
| P0-04 | Rider sin certificación física no puede ser GO | Rider README mantiene certificación física en `NOT_RUN`; runbook exige GPS, background, red, permisos y reinicio. | Convertir certificación física en gate de despliegue visible, no inferirla por tests. | No se declara piloto listo sin evidencia Moto G15/GPS/red/entrega/código. | Dispositivo real, backend staging y responsable de piloto |
| P0-05 | Preparación offline puede quedar incompleta para un novato | `business-operations-center.js` bloquea confirmación hasta reconciliar, pero el estado exige interpretar outbox/cache. | Exponer “lecturas guardadas / confirmadas / bloqueadas” y CTA único “Reconciliar antes de confirmar”. | Nadie puede cerrar packing mientras existan lecturas no reconciliadas; el motivo es comprensible. | Validación de copy y pruebas E2E existentes |
| P0-06 | Cierre de caja existe, pero no está integrado a la apertura/cola de riesgos | Centro muestra conciliación y cierre; `closeDailyReconciliation` sólo owner/admin. | Convertir cierre en checklist final: alertas críticas, dinero, pedidos abiertos, fiscal/print, hash y responsable. | El owner ve qué queda abierto y no puede creer que cerró si faltan alertas críticas sin explicación. | Decisión de política de cierre |
| P0-07 | Acciones sensibles aparecen antes de explicar rol/permiso | `production-operations.js:925-928` muestra Configuración fiscal a roles de negocio; el backend restringe por RPC. | Filtrar o marcar acciones por rol antes del toque; explicar “sólo owner/admin” en el lugar de acción. | Un empleado no entra en un formulario que luego falla por permiso; no hay error genérico como primera señal. | Matriz de roles y permisos productivos |

## P1

| ID | Problema | Propuesta |
|---|---|---|
| P1-01 | Centro y monitor de pagos son superficies separadas | Integrar pagos críticos en el Centro; mantener detalle financiero para owner/admin. |
| P1-02 | Impresión exige conocer estados de spooler | Agregar prueba inicial de impresora, papel y resultado “verificado / no verificable” con guía visual. |
| P1-03 | Setup local/demo se parece a configuración productiva | Etiquetar ambiente, autoridad y alcance en el propio encabezado; no decir sólo “Configuración guardada”. |
| P1-04 | Mensajes operativos no comparten patrón | Usar siempre “qué pasó / qué hacer / si se puede seguir / responsable”. |
| P1-05 | Scanner no ofrece recuperación de producto desconocido suficientemente visible | Después de GTIN desconocido, mostrar “buscar”, “crear borrador para revisión” y “cancelar”, sin ocultar el resultado. |
| P1-06 | Mobile operativo requiere evidencia de uso real | Testear 360/390/412/768 con dedos, teclado, orientación, scroll y accesos de error. |
| P1-07 | Soporte está en continuidad local, no junto al incidente | Cada alerta debe ofrecer diagnóstico contextual con ID/código sanitizado. |
| P1-08 | Rider muestra estados buenos, pero la acción siguiente varía por pantalla | Unificar CTA de permiso, red, GPS, refresco, reportar incidencia y llamar al negocio. |

## P2

| ID | Problema | Propuesta |
|---|---|---|
| P2-01 | Vocabulario amplio entre demo, producción y Rider | Crear glosario de negocio y mantener nombres consistentes en botones, estados y docs. |
| P2-02 | Métricas abundantes sin lectura rápida | Agregar resumen “3 cosas para resolver ahora” encima de la grilla. |
| P2-03 | Códigos técnicos aparecen en la superficie principal | Reubicar correlación/código en disclosure de soporte. |
| P2-04 | Feedback de éxito puede quedar lejos de la entidad operada | Mostrar resultado inline en el pedido/pago/documento, además de toast. |

## Fuera de alcance explícito

- home/header/logo/stories/search/cards/banners del storefront;
- navegación mobile del storefront y brand tokens;
- visual tests o estilos que estén siendo modificados por Claude;
- cualquier implementación antes de aprobar este audit.

