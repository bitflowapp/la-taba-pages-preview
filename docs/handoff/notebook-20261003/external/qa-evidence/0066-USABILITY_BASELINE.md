# La Taba — Baseline de usabilidad operativa

Fecha: 2026-08-03  
Fase: auditoría de lectura; sin cambios de código  
Responsable: Codex, responsable de usabilidad operativa y product design

## Alcance

Esta línea base cubre la operación diaria de cuatro personas:

- Cliente: compra, pago, confirmación y seguimiento.
- Walter/owner: apertura, pedidos, caja, pagos, fiscal, delivery y cierre.
- Empleado: pedidos, escaneo, inventario, preparación y mostrador.
- Rider: acceso, toma, retiro, navegación, entrega y recuperación ante fallas.

Quedan fuera de este audit: home pública, header, logo, stories, búsqueda, cards,
banners, navegación mobile del storefront, tokens visuales y visual tests que
Claude está modificando en `C:\1212\la-taba2-mobile-brand-refresh`.

## Evidencia revisada

Se revisaron en modo read-only los cuatro worktrees fuente indicados por el pedido:

| Fuente | HEAD revisado | Evidencia principal |
|---|---|---|
| Production RC | `4ca22af6d425c422fdca2be8e11798a2de170033` | panel operativo, checkout, pagos, fiscal, impresión, tests E2E y docs |
| ARCA readiness | `13936d5eedd36a211fa2ab4d255f30ad8fc0dbed` | estados de homologación, gates, política contable y worker privado |
| Mercado Pago staging RC | `0587712be87bc32ebae6be75220eeb863780387c` | estados de checkout, retorno, reconciliación y troubleshooting |
| Rider production RC | `214d2b49eff7bb78e4459161a381f646ddf2034b` | cola, permisos, GPS, entrega, offline y runbook de certificación |

También se consultaron `js/business.js`, `js/production-operations.js`,
`js/business/business-operations-center.js`, `js/core/business-setup.js`, los
repositorios fiscal/operativo, las suites E2E y las capturas visuales existentes.

## Limitación importante

Esto es un audit documental y de evidencia existente. No se ejecutó un piloto con
personas novatas, no se certificó impresora física y no se certificó un teléfono
Rider en campo. El README del Rider mantiene explícitamente el estado físico en
`NOT_RUN`; por lo tanto, la calidad técnica de los tests no se interpreta como
usabilidad operativa certificada.

## Diagnóstico ejecutivo

La Taba tiene una base técnica fuerte para estados, auditoría, idempotencia,
reconciliación y continuidad. Sin embargo, el producto todavía exige que Walter o
el empleado entiendan conceptos internos y armen su propio procedimiento. El
Centro de operación concentra información, pero no reemplaza una apertura de
jornada guiada ni un camino de recuperación por incidente.

El riesgo no es que falte una acción aislada; es que la persona no sepa:

1. si puede abrir el negocio;
2. qué trabajo debe hacer primero;
3. si una acción ya tuvo efecto cuando la red falló;
4. quién puede resolverla;
5. cuándo es seguro continuar o cerrar el día.

## Severidad de usabilidad

| Nivel | Criterio operativo |
|---|---|
| P0 | Puede producir cobro duplicado, pedido perdido, error fiscal, entrega no confirmada o bloqueo de la jornada; una persona novata no tiene una salida segura. |
| P1 | Produce demora, dependencia de Marco/soporte o errores frecuentes, pero existe un workaround conocido. |
| P2 | Aumenta carga cognitiva o tiempo, sin riesgo directo de dinero, pedido o entrega. |

## Hallazgos principales

| ID | Nivel | Hallazgo | Impacto |
|---|---:|---|---|
| U-01 | P0 | No hay una apertura de jornada que combine configuración, conectividad, pagos, fiscal, impresión, scanner, rider y soporte. | Walter debe visitar varias superficies y decidir manualmente si está listo para vender. |
| U-02 | P0 | Los estados de dinero y pagos requieren distinguir retorno, webhook, pedido, outbox, reconciliación y revisión manual. | Un novato puede volver a cobrar o preparar un pedido que todavía no está confirmado. |
| U-03 | P0 | Fiscal/ARCA expone estados internos y tiene gates correctos técnicamente, pero no una traducción “qué significa / quién lo resuelve / puedo seguir vendiendo”. | La operación queda bloqueada o escala a Marco aun cuando sólo falta una revisión contable o un PDF. |
| U-04 | P0 | La certificación física de Rider, GPS, lifecycle Android y entrega real no está ejecutada. | No hay evidencia suficiente para confiar en el último tramo más sensible del negocio. |
| U-05 | P1 | El Centro de operación muestra muchas métricas y alertas, pero no las ordena por una única secuencia de trabajo: dinero → pedido → preparación → entrega → cierre. | Se ve el estado, pero no necesariamente el próximo paso. |
| U-06 | P1 | Impresión distingue `queued`, `sent_to_spooler`, `unknown` y `completed_when_verifiable`, pero el operador debe conocer el significado técnico y verificar físicamente. | Riesgo de reimpresión innecesaria o de asumir que un comprobante salió. |
| U-07 | P1 | El setup demo guarda configuración “sólo en este dispositivo”; no equivale a onboarding productivo del negocio. | Se puede confundir configuración visual/local con configuración operativa autoritativa. |
| U-08 | P1 | El pago productivo tiene un monitor separado del Centro de operación. | Walter puede mirar “Pagos” y “Centro” como dos verdades distintas. |
| U-09 | P1 | El empleado puede llegar a superficies sensibles como `Configuración fiscal`, aunque la autoridad real esté restringida por RPC/rol. | La interfaz promete una capacidad que puede terminar en “no autorizado” sin anticiparlo. |
| U-10 | P2 | La navegación mantiene muchos destinos y vocabularios (`Centro`, `Pedidos`, `Escáner`, `Preparación`, `Fiscal`, `Configuración`, `Caja`, `Local`). | Aumenta tiempo de aprendizaje y preguntas de orientación. |

## Baseline por dimensión

| Dimensión | Estado actual | Lectura de diseño |
|---|---|---|
| Claridad del objetivo | Parcial | Las funciones existen, pero no existe una frase persistente del tipo “qué está bloqueando hoy”. |
| Priorización | Parcial | Hay métricas de dinero, pedidos, stock, delivery, fiscal e impresión; falta una cola única con prioridad y dueño. |
| Feedback | Bueno en estados críticos | El Rider y los pagos evitan afirmar éxito falso; falta lenguaje común y próximo paso en todas las superficies. |
| Recuperación | Técnicamente robusta, operativamente dispersa | Hay retry, outbox, reconciliación y auditoría, pero el operador no siempre sabe cuál usar. |
| Roles | Correctos en backend, ambiguos en UI | El acceso se comprueba, pero la visibilidad de acciones sensibles puede generar intentos fallidos. |
| Fiscal | Seguro, no autónomo | Los gates bloquean producción correctamente; el panel no guía a una persona no contable. |
| Impresión | Honesta sobre la incertidumbre | Falta una prueba de impresora y una ruta de soporte de un toque. |
| Rider | Buenos estados visibles | Falta validación física del dispositivo, señal, batería, background y recuperación. |
| Mobile operativo | En evolución | La agrupación mobile del negocio reduce overflow, pero no hay evidencia de prueba con tareas novatas. |
| Storefront cliente | No es el cuello de botella de esta fase | Se mantiene fuera del trabajo de Claude; sólo se auditan checkout/pago/seguimiento como operación de negocio. |

## Principios que deben regir la siguiente fase

1. Una excepción debe decir qué pasó, si se puede seguir, cuál es la acción segura,
   quién puede ejecutarla y cómo se confirma el cierre.
2. El sistema debe diferenciar “no sé todavía” de “falló” y “no autorizado”.
3. La operación de dinero debe tener un solo camino visible y no permitir reintentos
   ambiguos desde la interfaz.
4. Los nombres técnicos quedan como detalle de soporte, nunca como instrucción
   principal para Walter o el empleado.
5. La apertura y el cierre deben ser rituales breves, repetibles y auditables.
