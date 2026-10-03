# La Taba — Audit final de usabilidad operativa

Fecha: 2026-08-03  
Resultado: primera fase completada; implementación detenida a la espera de aprobación

## Veredicto

La Taba está técnicamente avanzada y contiene mecanismos valiosos para una
operación real: autoridad del servidor, estados conservadores, idempotencia,
outbox, reconciliación, auditoría, backup local, diagnóstico sanitizado y estados
Rider honestos. Eso es una buena base.

Como producto para una persona novata, todavía no está lista para una jornada
operativa autónoma. Falta una capa de conducción: apertura, prioridad, responsable,
acción segura y cierre. La persona debe recorrer muchas superficies y traducir
conceptos internos que no deberían ser parte de su trabajo diario.

## Qué está bien

- El retorno de Mercado Pago no se toma como autoridad y el sistema evita afirmar
  un pedido cuando sólo hay una respuesta del proveedor.
- El Centro de operación reúne señales relevantes: pedidos, pagos, stock, packing,
  entregas, fiscal, impresión, outbox y conciliaciones.
- El cierre diario exige diferencia documentada y limita el cierre final a owner/admin.
- El flujo fiscal separa venta, CAE, PDF privado e impresión; no inventa autorización.
- El Rider comunica sesión, permisos, GPS, red, señal débil, cola y confirmación del
  servidor en lenguaje relativamente entendible.
- La continuidad local y el diagnóstico excluyen secretos, rutas privadas y payloads.

## Qué bloquea la adopción

1. **No hay una apertura de jornada.** Hay herramientas, no un ritual operativo.
2. **El dinero sigue siendo de alto riesgo para novatos.** La recuperación existe,
   pero hay que saber cuándo reconciliar y cuándo no repetir.
3. **Fiscal/ARCA es seguro pero no autoexplicativo.** Los gates son correctos;
   falta indicar con claridad qué puede hacer el negocio mientras espera.
4. **El último tramo no está certificado físicamente.** Rider y dispositivos deben
   probarse en condiciones reales antes de presentar el piloto como listo.
5. **La arquitectura de superficies es compleja.** Demo/local, producción Windows,
   pagos, fiscal y Rider tienen vocabularios y entradas distintas.

## Recomendación de producto

No implementar cambios visuales amplios ni declarar “listo para piloto” todavía.
Primero aprobar y convertir en producto estos siete P0:

1. preflight de apertura;
2. incidente de pago incierto y pago aprobado sin pedido;
3. traducción de fiscal/ARCA;
4. gate físico Rider;
5. preparación offline comprensible;
6. cierre integrado con riesgos abiertos;
7. visibilidad de permisos por rol.

Después ejecutar el plan con usuarios novatos. Sólo cuando las tareas P0 pasen sin
ayuda y sin acciones inseguras conviene implementar P1 de impresión, soporte,
mobile operativo y unificación de vocabulario.

## Criterio de aprobación para la siguiente fase

Se puede aprobar implementación cuando el responsable confirme:

- qué ambiente será objeto de la primera experiencia guiada;
- quién es owner/admin, quién es empleado y quién es Rider de prueba;
- qué política define “jornada abierta” y “jornada cerrada”;
- qué estados de Mercado Pago y ARCA se mostrarán al negocio;
- qué dispositivo, impresora y red se usarán para certificación física;
- qué tareas se medirán con usuarios novatos y qué umbral define GO.

## Estado de trabajo

- Código fuente: no modificado por este audit.
- Worktree de Claude: no modificado.
- Worktrees RC/ARCA/MP/Rider: sólo lectura.
- Tests nuevos: no ejecutados ni agregados; se usó evidencia existente para evitar
  escrituras o contaminación de los worktrees fuente.
- Artefactos producidos: baseline, mapa diario, checklist de primer día, matriz de
  recuperación, plan de prueba, backlog P0/P1/P2 y este informe.

La siguiente acción queda deliberadamente en pausa hasta recibir aprobación del
audit y del orden de implementación.

