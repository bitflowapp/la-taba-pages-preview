# Task 04 — prueba de concurrencia real

## Resultado de esta ejecución

**PENDIENTE — no ejecutada en Supabase durante esta tarea.**

No se hizo una simulación engañosa con el mismo rider: el servidor considera
ese caso un retry idempotente del mismo asignado y no prueba la carrera entre
dos actores.

La auditoría de staging confirmó tres membresías rider activas mediante
consultas de sólo lectura, pero en el entorno de trabajo sólo está disponible
un archivo de credenciales rider. No se imprimieron ni se intentaron descubrir
contraseñas de Auth. Además, al momento de la auditoría no se confirmó una
orden QA en `ready`, sin asignar y apta para consumir.

La comprobación repetida durante este cierre fue también sólo lectura:

- sesión rider autenticada: `available_count=0`;
- sesión business autenticada: 7 órdenes visibles;
- `eligible_ready_unassigned=0`;
- la única orden no asignada observada (`LT-0004`) está en `preparing`, no en
  `ready`.

No se ejecutó el RPC de claim en ninguna de estas comprobaciones.

Todas las órdenes observadas del business de staging fueron fixtures QA; no
se identificó una orden comercial. No se ejecutó el RPC de claim y no se
alteró estado de Supabase como parte de este gate.

## Precondiciones para cerrar el gate humano

- segundo login rider QA independiente, activo en el mismo business y
  entregado fuera del repositorio;
- una orden QA explícitamente `ready`, `delivery`, sin asignar y con revisión
  conocida, confirmada justo antes de la prueba;
- dos clientes/Auth sessions independientes; nunca reutilizar el token del
  primer rider;
- captura de sólo código público, estado/revisión y resultados sanitizados;
  no guardar emails, tokens, UUID internos, direcciones ni payloads completos.

## Protocolo reproducible

1. Iniciar sesión en dos instancias staging con Rider A y Rider B.
2. Consultar disponibles en ambas y verificar el mismo `public_code` y la
   misma `revision`.
3. Enviar el botón “Tomar pedido” en ambas instancias con una diferencia menor
   a la latencia normal de red.
4. Registrar sólo: ganador/perdedor, `idempotent_no_op`, estado final,
   revisión final, cantidad de eventos y código público.
5. Confirmar por lecturas autorizadas que existe un único rider asignado, que
   la revisión avanzó exactamente una vez y que existe un único evento
   `order.rider_claimed` para la carrera.
6. Repetir el claim desde el ganador con el mismo snapshot y comprobar
   `idempotent_no_op=true`, sin incremento adicional de revisión ni evento.
7. Refrescar ambos clientes: el ganador ve asignado y el perdedor no ve el
   pedido disponible.

## Resultado esperado

| Comprobación | Resultado esperado |
|---|---|
| Ganador | Un único rider, snapshot asignado del RPC |
| Perdedor | Error sanitizado de carrera o revisión; nunca asignado |
| Revisión | `revision inicial + 1`, una sola vez |
| Evento | Un único `order.rider_claimed` |
| Retry ganador | Éxito idempotente, sin mutación adicional |
| Comercial | Cero órdenes comerciales tocadas |

## Evidencia previa no sustitutiva

Existe evidencia histórica de Gate 2 en otro artefacto de staging con dos
identidades QA, pero no corresponde a esta build Android y documenta que una
de las solicitudes no completó el pase HTTP dentro del timeout. Por eso se
conserva como contexto, no como aprobación de Task 04.

## Aprobación requerida

Una persona autorizada debe proporcionar el segundo login QA y confirmar la
orden QA elegible. Codex no debe crear usuarios, resetear estados, escribir
tablas ni usar `service_role` para cerrar este escenario.
