# TABA2 · auto-dispatch de Riders · informe de cierre

Fecha: 2026-08-11. Trabajo local. No hay push, ni staging, ni produccion.

## 1. HEAD

| Repo | Worktree | Rama | HEAD |
| --- | --- | --- | --- |
| Web | `D:/1212/worktrees/taba2-automated-rider-dispatch` | `feature/taba2-automated-rider-dispatch` | `a92247a` |
| Rider | `D:/1212/worktrees/taba2-rider-auto-dispatch` | `feature/taba2-rider-shifts-dispatch` | `b9b881d` |

Ambos worktrees quedan limpios. Base web `eda13f8`, base Rider `471f79e`.

Commits web (3, sobre `eda13f8`):

- `2f6dd95` motor completo, ranking, ofertas, accept, worker, override, Panel, ledger, cierre del bypass legado
- `86df2fe` autorizacion adversaria, contrato de nombres de argumento, politica versionada
- `a92247a` correcciones del security review

Commits Rider (2, sobre `471f79e`):

- `39089d8` turnos, latido, oferta con TTL, superficie sin PII
- `b9b881d` flag de mock validado

## 2. Donde se habia detenido Codex

La arquitectura, el simulador, el ranking JS y el Panel estaban completos. El
motor no: la migracion `20260811101000` terminaba en
`configure_business_auto_dispatch` y no existian ranking SQL, creacion de
ofertas, `accept`, `reject`, worker, override, control del Panel, ledger ni
triggers de `orders`. Tampoco habia **un solo grant**, asi que ninguna de las
RPC ya escritas era alcanzable. En Rider habia ~1.361 lineas sin commitear con
tres tests en rojo.

## 3. Migraciones y RPC

- `20260811100000_rider_dispatch_foundation.sql` — 12 tablas, indices
  parciales, triggers append-only, RLS. Ya estaba.
- `20260811101000_rider_dispatch_engine.sql` — helpers, idempotencia, turnos,
  perfiles, kill switch. Se completo con los locks de job y las revocaciones
  propias.
- `20260811102000_rider_dispatch_runtime.sql` — **nuevo**: ranking,
  evaluaciones, ofertas, `accept`, `reject`, worker, sweep, override, control
  del Panel, ledger, triggers de ciclo de vida, cierre del bypass legado y
  todos los grants.

Superficie autenticada: 9 RPC de Rider y 5 de Panel. El worker es
`service_role`. Todo lo demas es interno.

## 4. Maquinas de estado

Implementadas tal como estaban documentadas, sin cambios de diseño.

- Turno: `scheduled -> active -> paused -> active -> ended`.
- Job: `queued -> ranking -> offering -> claimed -> completed`, con
  `no_rider_available` y `cancelled`.
- Oferta: `offered -> accepted | rejected | expired | revoked`.

## 5. Fairness

Ranking determinístico en SQL, espejo exacto del modulo JS. Cada Rider del
negocio deja una evaluacion por ronda —elegible o no— con distancia, carga,
idle, asignaciones de 4 h, edades de latido y GPS, componentes del score, score
y rank. El Panel puede explicar por que X fue antes que Y sin ver coordenadas.

Simulador: 44 escenarios, `PASS`, SHA-256
`9d87db73b4ce5d08a125df810ff0bb7589f62e0f566b819e359edd2a3998c406`.

- 0 escenarios con starvation
- 0 claims duplicados
- 0 rewards duplicados
- 0 jobs duplicados
- rafagas simultaneas con 1/2/5/10 Riders: Jain `1.000`, todos los pedidos completados

El Jain bajo en escenarios de un solo pedido (`0.100` con 10 Riders) es
correcto por definicion: un pedido lo toma un Rider. La medida util es la de
rafaga.

## 6. Seguridad

Detalle completo en `docs/AUTOMATED-RIDER-DISPATCH-SECURITY-REVIEW.md`.

- Bypass legado cerrado en **ambas** firmas: `change_order_status(uuid,text,text)`
  y `transition_order(uuid,bigint,text)` ya no son ejecutables por
  `authenticated`.
- 12 intentos hostiles contra la base, todos rechazados, y el pedido sigue sin
  dueño despues de los 12.
- Oferta previa al claim sin nombre, telefono, direccion exacta, notas ni
  coordenadas.
- Control del Panel sin PII ni GPS: clasifica presencia en vez de exponerla.
- 45 funciones con `search_path` explicito; 12 tablas con RLS y cero
  privilegios directos; esquema `private` inalcanzable.
- Cuatro hallazgos sub-umbral corregidos igual: ventana de deploy entre
  migraciones, CAS opcional en el override, `p_is_mock` literal y lookup de
  etiquetas por clave de prototipo.

## 7. Suites

| Suite | Resultado |
| --- | --- |
| Web (`npm test`) | 1318 / 1318 |
| Contrato DB + carreras (`npm run test:dispatch:db`) | PASS |
| Simulador | 44 escenarios, hash estable |
| Rider Flutter | 289 / 289 |
| Rider Kotlin unit | 90 / 90 |
| `flutter analyze` | sin issues |

Las cuatro carreras usan dos sesiones PostgreSQL reales con barrera temporal:
doble tap, oferta vencida contra vigente, accept contra override y accept
contra sweep.

Reproducir el gate de base de datos:

```bash
TABA_LOCAL_DISPATCH_DB=1 npm run test:dispatch:db
```

Levanta su propio contenedor efimero. Del contenedor Supabase compartido de
otro worktree solo **lee** los esquemas `auth` y `storage`; no lo modifica ni
toca sus GUC de cluster.

## 8. Defectos encontrados y corregidos

1. `dispatch_jobs` usa `revision`, pero compartia el trigger que asigna
   `version`: cualquier UPDATE del job fallaba. El motor entero era inejecutable.
2. Los codigos de exclusion se concatenaban sin castear y PostgreSQL los leia
   como literal de array.
3. `accept` tomaba oferta -> job y el override job -> oferta: `deadlock
   detected` en la carrera real. Hay ahora un unico orden de locks.
4. `reject_rider_dispatch_offer` declaraba `p_reason` y el cliente Kotlin
   manda `p_reason_code`. Con argumentos nombrados rompia en runtime, no al
   migrar.
5. Tres tests de cadencia del Rider fallaban por temporizadores pendientes.
6. Los cuatro hallazgos del security review.

## 9. Deuda abierta

- **Reconnect real de app.** Cubierto por el simulador, no por un ciclo de vida
  de proceso real en Android.
- **Deadlock cruzado con mutaciones externas del pedido.** Una cancelacion del
  Panel concurrente con un accept todavia puede trabar; PostgreSQL revierte un
  lado y los invariantes se sostienen, pero el Rider ve un error en vez de un
  receipt. Cerrarlo exige que cada RPC de estado de pedido tome primero el
  advisory del job.
- **Autenticidad del GPS.** Un cliente modificado puede mandar coordenadas
  falsas con `is_mock = false`. Limitacion del modelo.
- **Borrado fisico de pedidos.** `dispatch_events` es append-only y referencia
  `orders` con cascade, asi que un pedido con historial de dispatch ya no se
  puede borrar. En produccion se cancela, no se borra.
- **Metricas p95** se calculan sobre ventana de 24 h sin materializar; con
  volumen conviene precomputarlas.
- **Capacidad fija en 1.** El esquema conserva `max_concurrent_orders` pero hay
  un check que lo fija hasta que la UI represente mas de una entrega.

## 10. Conflictos de integracion

Ninguno medido. Los 20 archivos tocados en web no se superponen con
`taba2-commercial-production-hardening` (unico worktree con cambios sobre la
misma base `eda13f8`); `taba2-operational-resilience` esta limpio. No se toco
`js/map/**`, `js/tracking/**`, `js/delivery.js`, `styles/tracking.css`,
`js/ui.js`, `index.html` ni los bloques de tracking de `styles/responsive.css`,
que es la frontera con el trabajo de tracking ya cerrado en `36b6f3d`.

En Rider se toco `rider_home_page.dart` por dependencia estricta de la
composicion, pero no `rider_map.dart`, `map_style.dart`, markers ni overlays.

## 11. Plan de staging

Nada de esto se ejecuto. Es la propuesta.

1. Tomar el lock de staging. Hoy no esta tomado por este trabajo.
2. Aplicar las tres migraciones. Nacen inertes:
   `auto_dispatch_enabled = false`, `qa_fixture_only = true`.
3. Verificar sobre staging la superficie: grants, `search_path`, RLS y que el
   bypass legado quedo cerrado. Es la misma consulta que corre el gate local.
4. Cargar fixtures propios con `origin = 'qa'` y su entrada en
   `private.rider_dispatch_qa_allowlist`. Cero datos humanos.
5. Encender con `configure_business_auto_dispatch(..., enabled => true,
   qa_fixture_only => true, motivo)`. Solo alcanza a pedidos QA.
6. Programar el worker (`run_rider_dispatch_cycle`, `service_role`) cada 5 s.
7. Correr el recorrido con dos Riders fisicos: turno, latido, oferta, accept,
   entrega, fin de turno durante entrega.
8. Rollback inmediato: `enabled => false`. Revoca ofertas vivas, no borra jobs
   ni auditoria, y no toca entregas aceptadas.

Habilitar pedidos de produccion (`qa_fixture_only => false`) es una decision
operativa posterior y explicita, con motivo auditado.

## 12. Declaracion

**No corresponde declarar `TABA2_AUTOMATED_RIDER_DISPATCH_READY_FOR_STAGING`.**

La cadena central esta demostrada de punta a punta contra un PostgreSQL real:
pedido listo -> job exactly-once -> seleccion determinística -> oferta con lease
-> accept atomico -> exactamente un Rider -> la entrega continua aunque el turno
termine, sin intervencion del negocio.

Lo que falta no es la cadena: es que nada de esto se ejecuto todavia contra
staging. Los dos gates pendientes —lock de staging con fixtures propios y
rollback, y el reconnect real de la app— son de ejecucion, no de diseño. Hasta
correrlos, la declaracion seria sobre un entorno que nadie probo.
