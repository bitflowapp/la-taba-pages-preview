# La Taba — Plan de prueba con usuarios novatos

## Objetivo

Validar si una persona sin conocimiento de Supabase, ARCA, Mercado Pago, outbox o
Tauri puede operar un turno controlado sin perder pedidos, duplicar cobros,
confundir estados ni depender de Marco para tareas normales.

## No se valida en esta fase

No se deben usar pagos reales, certificados reales, datos fiscales reales ni un
piloto productivo. Las tareas se ejecutan con fixtures sintéticos y se etiqueta
`NOT_RUN` cualquier comportamiento que requiera impresora física, GPS real,
background Android o red móvil.

## Participantes

| Grupo | Cantidad sugerida | Perfil |
|---|---:|---|
| Owner/Walter | 2 | decide dinero, cierre y excepciones; no técnico |
| Empleado | 2 | prepara, escanea y atiende mostrador |
| Rider | 2 | usa Android; conoce reparto, no la arquitectura |
| Cliente | 2 | compra desde mobile sin explicación previa |

## Moderación

- No explicar dónde está la acción antes de empezar.
- Leer la consigna, no el camino.
- Preguntar “¿qué esperás que pase?” antes del primer toque y “¿qué harías ahora?”
  después de un error.
- No corregir durante la tarea salvo riesgo de seguridad o uso de datos reales.
- Registrar pantalla, tiempo, toques extra, palabras usadas y dependencia solicitada.

## Tareas

| ID | Persona | Consigna neutral | Éxito observable |
|---|---|---|---|
| T1 | Walter | “Es el primer día. Decidí si el local está listo para recibir y cobrar.” | encuentra una preflight, identifica bloqueos y no necesita interpretar códigos técnicos |
| T2 | Walter | “Llegó un pago aprobado pero el pedido no aparece. Resolvelo sin cobrar de nuevo.” | elige reconciliar/revisar; no crea pedido paralelo ni repite pago |
| T3 | Empleado | “Tomá este pedido, preparalo con scanner y resolvé un faltante.” | distingue faltante de error de scanner; deja el pedido en estado seguro |
| T4 | Empleado | “La red se corta después de escanear. Decidí si podés confirmar.” | reconoce pendiente/offline y espera reconciliación |
| T5 | Walter | “Hay un comprobante autorizado pero el PDF falló y la impresora no confirma.” | no refiscaliza; distingue PDF de impresión y sabe a quién escalar |
| T6 | Walter | “Revisá ARCA/Mercado Pago para saber qué falta antes de abrir.” | entiende si está homologación, producción bloqueada o revisión pendiente |
| T7 | Rider | “Tomá un pedido y empezá la entrega con ubicación denegada.” | entiende por qué no puede salir, abre Ajustes y no falsifica salida |
| T8 | Rider | “Perdiste señal durante la entrega.” | distingue última confirmación de estado actual; no pulsa acciones repetidas |
| T9 | Rider | “El cliente da un código incorrecto y luego informa que no puede recibir.” | respeta rate limit y reporta una incidencia adecuada |
| T10 | Cliente | “Confirmá un pedido delivery con pago que queda pendiente.” | conserva carrito, entiende que no debe pagar otra vez y encuentra el estado |
| T11 | Walter | “Terminó el turno y hay una diferencia de caja.” | prepara conciliación, escribe una explicación y entiende quién puede cerrar |
| T12 | Walter | “Exportá evidencia para soporte.” | usa diagnóstico sanitizado y no intenta copiar secretos/PII |

## Datos y estados de prueba

- pedido nuevo, demorado, sin stock, packing incompleto;
- pago aprobado sin pedido, pendiente, ambiguo y refund no confirmado;
- documento autorizado/PDF pendiente/PDF fallido/impresión `unknown`;
- Rider con sesión vencida, permiso denegado, GPS débil, offline y conflicto;
- caja con diferencia explicada y alerta crítica abierta.

## Métricas de aceptación

| Métrica | Umbral inicial |
|---|---:|
| Tareas P0 completadas sin ayuda | ≥ 90% |
| Tareas P0 con acción insegura | 0 |
| Usuarios que entienden “no repetir” en dinero | 100% |
| Usuarios que identifican responsable de un bloqueo | ≥ 90% |
| Usuarios que distinguen pendiente vs incierto vs rechazado | ≥ 80% |
| Toques extra en apertura/cierre | ≤ 3 por paso |
| Solicitudes de ayuda a Marco en tarea rutinaria | 0 |
| Incidentes físicos sin evidencia | Se reportan como `NOT_RUN`, nunca como éxito |

## Criterio de salida

No pasar a implementación amplia si dos participantes cometen el mismo error P0,
si alguien interpreta `sent_to_spooler` como impreso, si alguien repite un pago por
incertidumbre o si el Rider inicia sin permisos/confirmación. Cada fallo debe
convertirse en una entrada del backlog con pantalla, copy, rol y evidencia.

