# LA TABA — estado del operador autónomo de backend

Archivo vivo: se reescribe después de cada frente. Sin secretos. Fuente de verdad: código + git + tests + CI + lecturas en vivo
de sólo lectura. Lo que dice una sesión anterior se cita como «declarado» hasta verificarlo.

## Para retomar (leer primero)

- Informe final: `LA_TABA_AUTONOMOUS_BACKEND_REPORT.md` (estado, hallazgos, OWNER_APPROVAL_REQUIRED con pasos exactos, veredictos).
- Actualizado 2026-10-03 18:22 (-03:00). Último commit de código: `3573140a`; después, tres de pruebas de regresión
  (`2018ea51`, `4a0ce219`, `3a080d44`) y el de documentación que trae este archivo. Tarea en curso: cerrar la cuarta revisión
  de 20261003090000 (revisor, gate local y CI). Próximo paso: atender lo que encuentre la cuarta pasada y dejar el CI del HEAD
  final en verde.
- Rama `hardening/taba-ecommerce-production`, todo pusheado. **PR #133 en borrador** contra `main` (apilado sobre #130): existe
  para que el CI completo corra en cada push, porque desde la sesión en la nube el despacho manual de workflows da 403.
  No se mergea sin el dueño. Nada aplicado en Staging (158) ni en CP (157); la rama tiene 211 migraciones (157 de `main` + 54).
- Herramientas que ya están en el repo (sirven en la PC, en CI o en la nube): `scripts/db/dev-database.mjs start|test|stop`
  (base local con la imagen y la secuencia exacta del gate, que queda viva para reproducir y escribir pgTAP),
  `npm run test:db:isolated` (el gate canónico entero, necesita Docker), `scripts/release/run-readonly-checks.mjs` y
  `scripts/production-health-check.mjs --target controlled-production` (sólo lectura, necesitan un token de la Management API).
- La sesión en la nube no tiene token de Supabase ni de Mercado Pago: no leyó Staging ni CP. Lo último leído en vivo es de la
  sesión de la mañana (11:20–11:25).
- En curso al escribir esto: el CI del HEAD final en el PR #133 y una cuarta pasada del revisor sobre `6fd0b6f4..3573140a`
  (la cuarta revisión de 20261003090000 y el cambio de 20261003092000; su resultado queda en la bitácora y en el informe).

## Sesión 2 — 2026-10-03 14:47–18:xx (-03:00), Claude Cloud

### Checkpoint inicial (verificado, no declarado)

| Dato | Valor |
|---|---|
| Rama / HEAD inicial | `hardening/taba-ecommerce-production` @ `8f0d5958` (= `origin`), árbol limpio; `main` = `13581889` |
| CI sobre `8f0d5958` | **verde**: `Validate release candidate` run 37130800496 (la sesión anterior se cortó antes de verlo) |
| Stack efímero | último verde sobre `2bc7218a` (37129059684, 450/455, 0 FAIL); no corre si el push no toca `supabase/**` y similares |
| PR | ninguno de esta rama; #130 (su base) abierto |
| Gate canónico local | reproducido en este contenedor (Docker + la imagen del gate por digest) sobre `8f0d5958`: **PASS** (pgTAP 5.938, carreras con 0 deadlocks, simulacros de reversión, restauración) |
| Registro | P1: 14 corregidos, 1 riesgo aceptado, 0 abiertos · P2: 36 corregidos, 22 abiertos |
| Acceso a entornos | sin credenciales de Supabase/Mercado Pago en la nube: Staging y CP **no** se leyeron en esta sesión |

### Bitácora

- 14:50 — estado reconstruido desde git, CI y documentos. DIAG-03 seguía abierto (la sonda de salud).
- 15:05 — **PAY-PROBE-02 (P1, nuevo), reproducido**: pasada la ventana de 48 horas, la alerta CHECKOUT_PROVIDER_UNVERIFIED de un
  checkout que nadie verificó (vacíos no concluyentes o ninguna sonda respondida) la cerraba el sistema («condición ausente») y el
  barrido dejaba de preguntar. 47 h: abierta; 49 h: resuelta sola. Corregido en `d89ad936` (20261003090000).
- 15:12 — **DIAG-03 corregido** (`b6a94a96`): la sonda de salud no veía alertas CRITICAL (comparaba en minúscula) y exigía
  exactamente cuatro tareas. Reproducido contra la base local con un rol igual a `supabase_read_only_user`.
- 15:14 — PR #133 en borrador para que corra el CI. CI completo y stack despachados por el push de `aae0268d`.
- 15:17 — **PAY-PROBE-03 (P1, nuevo), reproducido**: un pago con tarjeta en revisión manual (`in_process`) sobre un checkout
  vencido no tenía ninguna alerta y pasadas las 48 horas nadie lo releía. Corregido en `56a76d24` (misma migración, todavía sin
  aplicar en ningún entorno).
- 15:27 — **CERT-02 (P3), causa raíz**: la fase `health` leyó a las 18:21:44Z y pg_cron corrió el primer barrido a las 18:22:00Z
  (frontera del minuto): latido «nunca», componente «down». La corrida del PR llegó después y pasó. Corregido en `632df82a`: en el
  stack se espera el primer latido (tope 90 s) antes de afirmar; las aserciones no cambian.
- 15:28 — gate canónico local sobre `aae0268d`: **PASS** (pgTAP 5.993 con las 55 nuevas, carreras con 0 deadlocks, simulacros,
  restauración). `npm test`: 3.126, 0 fallas, 1 skip de plataforma (PowerShell). CI de `aae0268d`: base de datos **verde**,
  Windows **verde**, stack del PR **verde**; stack del push **rojo** en 2 checks de `health`.
- 15:30 — más: verificación previa de 20261003090000 (`e17fe311`), herramienta de base local versionada (`3986674e`, validada de
  punta a punta: 209 migraciones en ~30 s), y el pulso de CP cuenta un cobro sin pedido desde su aprobación (`288da41f`, PULSE-01).
  Un cambio de texto del Panel para la alerta se revirtió: obliga a subir la identidad del service worker (línea de frontend).
- Auditoría de autorización (sólo lectura, base local): ninguna tabla pública admite INSERT/UPDATE/DELETE directo de clientes
  salvo columnas de `businesses` (AUTHZ-02, ya registrado) y `products.sort_order`; las políticas están acotadas al comercio; las
  16 funciones SECURITY DEFINER que una heurística marcó sin control delegan la autorización o son públicas por diseño.
- 15:40 — **DIAG-02 (backend) corregido** (`6dc0e883`, 20261003091000): el contador `blocked_outboxes` del centro de operación
  no contaba un aviso de Mercado Pago abandonado (0 antes de la migración; 1 y 2 después). Push de los 8 commits.
- 15:46 — CI de `6dc0e883`: base de datos **verde**; certificador del stack **verde en las dos corridas** (push y PR: 455 checks,
  450 PASS, 0 FAIL). Gate local sobre `6dc0e883`: **FAIL** en la carrera de stock (escenario 7, «la sesion vence exactamente una
  vez» 0 ≠ 1) con la máquina cargada. **RACE-01, causa reproducida**: el aviso de pago retiene la fila de la sesión con
  `for update` y el barrido saltea filas tomadas (`skip locked`); con la fila tomada, tres barridos devolvieron 0 y, liberada, el
  siguiente 1. No es el producto (el barrido del minuto siguiente la vence). Arreglo en el arnés: un barrido más después de la
  ronda y la cuenta total sigue teniendo que ser exactamente uno.
- AUTHZ-04 y Caja Clara, precisado: el E2E de Caja Clara en CP (42/42) conecta la caja con la credencial del **dueño** y la limpieza
  QA cancela como dueño: ninguna certificación de CP cancela como empleado. Una caja real operada con cuenta de **staff** sí pierde
  cancelar y rechazar al aplicar 20261002050000.
- 16:00 — CI completo de `4187db74` **verde** por primera vez en un HEAD reciente (web con E2E de navegador, 31 min; base de
  datos; Windows; stack efímero en las dos corridas). Queda superado: ese HEAD tiene la primera versión de 20261003090000.
- 16:00 — **revisión adversarial independiente** (subagente de sólo lectura sobre `8f0d5958..dd5f57af`): 5 hallazgos sobre mi
  propia primera versión de 20261003090000, ninguna aplicada en un entorno. **PAY-PROBE-04 (P1)**: un vacío concluyente
  anterior al pago callaba la alerta y la sonda diaria de un pago `in_process` (49 h: sin alerta de ningún código, sin sonda).
  **PAY-PROBE-05 (P2)**: la resolución del dueño no se comparaba con lo posterior, frenaba la relectura y cambiaba lo de
  adentro de la ventana. **PAY-PROBE-06 (P2)**: costo por minuto proporcional a toda la historia (20.000 checkouts: ~475 ms y
  ~400 ms). P3: aserciones que pasaban por otra razón y una verificación previa (U2/U3) con afirmaciones inexactas.
- 16:20 — mapa de cobertura de las suites huérfanas del núcleo de pedidos (TOOL-04, subagente): no reviven arreglando fixtures
  (llaman funciones v1 que el contrato A1-A4 retiró); 14/18, 60/74, 19/20 y 3/12 comprobaciones ya están cubiertas por el
  gate o el certificador; queda una lista priorizada para portar (regresión de estados del cobro, reembolso después de un
  rearmado sin stock, STOCK_RESERVATION_STUCK, dos repartidores con `claim_delivery_order`, ORDER_READY_WITHOUT_RIDER).
- 16:25 — **TOOL-11 (P2, nuevo)**: 12 archivos de `supabase/tests` no corren en ningún gate ni workflow. Sobre el esquema actual,
  5 pasan tal cual (aislamiento de back-office 28, de perfiles de cliente 47, taxonomía 20, aprobación de registro 98) y 2
  tenían fixtures viejos (la oferta releída después de aceptada; un asset atado a otro SKU desde 20260927175058): corregidos,
  14/14 y 16/16. En curso: sumarlos al gate canónico.
- 16:40 — **`d6532530`**: 20261003090000 reescrita en su lugar. Un vacío sólo prueba no-pago sin pago guardado; la resolución
  de una persona se mira sólo pasada la ventana y vale mientras el proveedor no informe un pago o un estado nuevo; la sonda
  no la frena; barrido y alerta por etapas (20.000 checkouts: 7-10 ms y 64-90 ms, como antes). Prueba de 55 a 84 aserciones
  (11 fallan con la primera versión), 12/12 mutaciones detectadas, simulacro de reversión exacto. Gate canónico local completo
  **PASS** (pgTAP 6.031), `npm test` 3.130/3.131, verificaciones estáticas PASS. Registro: P1 17 corregidos, 0 abiertos.
- 16:50 — **segunda revisión adversarial** sobre `d6532530`: **PAY-PROBE-07 (P2)**, el cobro guarda el pago más nuevo y un
  reintento rechazado en la misma preferencia tapaba un pago todavía en revisión (49 h: sin alerta, sin sonda); **DIAG-14 (P2,
  anterior a la sesión)**, el barrido de alertas salteaba un negocio cerrado sin alertas abiertas, y «cerrado» es el botón de fin
  de día del Panel; P3: la resolución se comparaba con la hora de resolver y no con el último refresco de la evidencia, U3
  clasificaba mal un cierre por pago en revisión, y dos guardas no tenían prueba. Todo reproducido con sus guiones.
- 16:55 — `e3626e89` (TOOL-11): los diez pgTAP huérfanos que pasan entran al gate (+347). El ID provisorio TOOL-08 chocaba con uno
  de un mapa anterior (lo mismo DIAG-11): quedaron TOOL-11 y DIAG-14.
- 17:05 — **`dcd541cb`** (tercera revisión de 20261003090000: último estado de cada pago, la sonda relee por id el pago sin resolver,
  corte en el último refresco, U3; 97 aserciones, 18/18 mutaciones; reversión exacta; 20.000 checkouts: 9-10 ms y 49-58 ms),
  **`c5166237`** (20261003092000: un negocio cerrado con cobros movidos en 30 días se evalúa; la prueba falla antes y pasa
  después; reversión exacta) y **`5f9a326b`** (TOOL-04 cerrado: `order_core_gaps_test.sql`, 41, lo que las suites viejas probaban
  y nada probaba). Gate canónico local completo **PASS con pgTAP 6.440**, `npm test` 3.130/3.131, verificaciones estáticas PASS.
  Registro: P1 17 corregidos y 0 abiertos; P2 43 corregidos y 20 abiertos. Abiertos y documentados: ALERT-STOCK-01 (P3, texto del
  Panel) y RIDER-01 (P3, presencia del repartidor en la cola: decisión).
- 17:32 — **tercera revisión adversarial** sobre `dcd541cb..5f9a326b`, todo reproducido con sus guiones: **PAY-PROBE-08 (P2)**: la
  tarjeta A queda en revisión y sus avisos se pierden (nunca se asienta); el reintento B se rechaza y es lo único asentado. Con el
  guardado rechazado la sonda busca por la referencia externa, que devuelve el aprobado o el más nuevo (B), y pasadas 48 h el barrido
  dejaba de buscar: a 49 h sin alerta y sin sonda; si A se aprueba al tercer día con el aviso perdido, cobro sin pedido y sin señal.
  P3: un pago sin resolver asentado pasados 30 días detrás de un guardado final no abría la alerta; con 20.000 rechazados el paso
  caro de la reconciliación se encarecía; la selección de 20261003092000 leía por `updated_at` toda la historia de un negocio
  cerrado y dormido (~32 ms con 100.000 cobros); la resolución comparaba horas de asiento (un asiento confirmado después del
  refresco con hora anterior contaba como visto); tres mutaciones vivas (el orden por la hora del proveedor, el pago sin resolver
  más nuevo y el límite de 30 días de 092000).
- 17:58 — **`6812143a`** (cuarta revisión de 20261003090000: una búsqueda por día durante 30 días detrás de un rechazo o una
  cancelación guardados; un pago sin resolver asentado abre la alerta a cualquier edad por un índice parcial nuevo; la resolución
  vale mientras el pago y el estado que la evidencia mostraba sean los de hoy, sin horas; 107 aserciones, las de H1, H4 y H6 fallan
  con `dcd541cb`; arnés de 23 mutaciones, 23 detectadas; reversión exacta; 20.000 rechazados: reconciliación ~60 ms, barrido
  ~0,5 s, ~25 µs por checkout para el ritmo diario) y **`3573140a`** (20261003092000: los negocios cerrados se eligen por cobros
  creados en 30 días, por el índice existente, ~0,5-1 ms; 9 aserciones). Gate canónico local completo **PASS con pgTAP 6.452**
  (carreras con 0 deadlocks, simulacros, restauración), `npm test` 3.130/3.131 (1 skip de plataforma), `npm run check` y
  `migrations:validate` PASS. Registro: P1 17 corregidos y 0 abiertos; P2 44 corregidos y 20 abiertos. Residual P3 documentado
  en DIAG-14: un negocio cerrado sin checkouts en 30 días ni alertas abiertas no se evalúa si le llega tarde un aviso sobre un
  cobro viejo (un reembolso o contracargo hecho después en Mercado Pago); se calcula al reabrir (un cobro aprobado sin pedido lo
  cuenta igual el pulso de CP, desde las tablas). Cuarta pasada del revisor pedida sobre estos dos commits.
- 18:05 — push de `dfedfcc1`. Su CI: base de datos (6.452), Windows y el stack efímero en las dos corridas **verdes**; el job
  web quedó en curso y lo reemplaza el push siguiente.
- 18:20 — tres pruebas de regresión del mapa de TOOL-04 (ninguna corrige código: la conducta ya era la correcta):
  **`2018ea51`** el repartidor ve el punto exacto del cliente sólo después de tomar la entrega (la cola da el barrio y ninguna
  columna trae calle, teléfono ni coordenadas; la función del mapa no lo revela aunque esté guardado; la tabla no le muestra el
  pedido; después del claim lo lee exacto, otro repartidor no, y dado de baja o entregado el pedido deja de verlo; 18, cinco
  mutaciones de las guardas detectadas); **`4a0ce219`** un ciclo limpio (Mercado Pago con retiro, con el worker completando su
  trabajo, y efectivo con envío por la cola) no deja ninguna alerta, ni abierta ni resuelta, con todas sus horas corridas tres
  horas atrás para que se evalúe cada regla con umbral de tiempo (cinco mutaciones de falso positivo detectadas, que sin el
  corrimiento sobreviven); **`3a080d44`** en ese ciclo el Panel ve el pedido de Checkout Pro una vez y el checkout pagado deja
  de figurar como pendiente. pgTAP canónico 6.488. Gate canónico local completo **PASS** sobre `2018ea51` (6.470); el de
  `3a080d44` corría al escribir esto. Del mapa de TOOL-04 sólo quedan sin portar las métricas del centro de operación (P3).

## Sesión 1 — 2026-10-03 08:22–13:2x (-03:00), PC de trabajo (histórico)

### Checkpoint inicial — 2026-10-03 08:40 (-03:00)

| Dato | Valor verificado |
|---|---|
| Worktree | `la-taba-ecommerce-hardening` (worktree de la PC de trabajo; repo `bitflowapp/la-taba-pages-preview`, público) |
| Rama | `hardening/taba-ecommerce-production` (apilada sobre `qa/taba-backend-e2e-cert-20260930` = PR #130, abierto) |
| HEAD inicial | `47d9ffe9` local, 1 commit por delante de `origin` (`423cd90d`) — herramienta de preflight de sólo lectura, sin push |
| `origin/main` | `13581889` · `origin/release/taba-controlled-production` `4e215da4` |
| Working tree | 5 archivos modificados (Edge TS de pagos del paquete wp13 + workflow del stack) y 10 rutas sin seguimiento (certificador `scripts/e2e-staging/ecommerce*`, `scripts/order-intake/idempotency-race.mjs`, 5 tests, plan de promoción, umbrales de performance) — todo borrador sin revisar de la sesión anterior |
| CI de la rama | último `Validate release candidate`: run 37062830721 sobre `d41cf29e` **verde**; `Ecommerce certification on an ephemeral Supabase stack`: run 37067129076 sobre `eaa6b5fe` **verde** (190 migraciones sobre un Supabase completo efímero). Sin CI sobre `423cd90d` (sólo docs) ni `47d9ffe9` |
| Tests conocidos | declarados por la sesión anterior: pgTAP canónico 64 archivos / 4106 aserciones, `npm test` 2969 — **no re-verificados todavía**. Verificado ahora: `tests/run-readonly-checks.test.mjs` 5/5 |
| Staging (`ucbtjcurawxjwjdvvcvj`) | accesible en sólo lectura (Management API). Ledger 158 migraciones; el repo tiene 190 → faltan las 32 de esta rama. Ninguna migración remota ajena al repo |
| CONTROLLED PRODUCTION (`tkanbadcglszlcyfjvpv`) | accesible en sólo lectura. Ledger 157 (le falta además `20261001010000` de la línea principal). **Protegida: sólo lectura** |
| Preflight de migraciones | `scripts/release/run-readonly-checks.mjs` corrido ahora contra Staging y CP: 21/21 consultas sin error en ambos. Integridad de dinero en 0 filas en ambos (`double_converted`, `order_on_refunded_payment`, `refund_in_flight`, `cancellation_downgraded`, `approved_payment_without_order`). Salidas: `artifacts/taba-autonomous-20261003/preflight-*-0835.json` |
| Procesos / agentes | Esta sesión de Claude Code. Codex app-server activo: su hilo de frontend (`la-taba-frontend-polish`, PR #131) terminó 02:21; un hilo de 08:26 sólo **programó el apagado de la PC en 5 h → ~13:27** (evento 1074, a pedido del usuario: no se cancela). Sin Postgres/PostgREST/Docker corriendo. La sesión de backend anterior (Claude `04e206e5`) terminó ~02:21 con 5 agentes a medio camino (murieron con ella) |
| Recursos | 16 GB RAM (6,5 GB libres), CPU de 2 núcleos / 4 hilos, 172 GB libres en C: |
| Worktrees | 31 de este repo + 3 en `Documents/Codex`. Con cambios ajenos sin commit (NO se tocan): `la-taba-caja-final` (línea Caja Clara, migración `20261001030000` sin commit), `la-taba-frontend-polish` (85), `la-taba-pages-preview` (checkout principal, 146), `la-taba-premium-motion` (8), `la-taba-commercial-preview` (1), `la-taba-controlled-production` (1) |

#### Los cinco frentes — clasificación inicial (con evidencia)

| Frente | Estado | Evidencia |
|---|---|---|
| Idempotencia | `INCOMPLETE` | El arnés `scripts/order-intake/idempotency-race.mjs` existe sin seguimiento y, según su autor, da `GLOBAL_IDEMPOTENCY: FAIL` con 4 defectos reales (orden de bloqueos en la cancelación de pago → 40P01, libreta de direcciones sin serializar, default de dirección con violación de unique cruda, reintento con código de entrega equivocado) + un deadlock rider offer/accept. Los arreglos (4 migraciones `20261002040000-043000` + pgTAP `idempotent_retries_test.sql`) son borradores sin revisar en el mirror `wp/wp18` de la sesión anterior |
| Pagos | `INCOMPLETE` | Lo ya integrado (wp3a/wp3b/WP4, reconciliación, gates) tiene CI verde. El paquete nuevo wp13 (4 migraciones `20261002020000-023000`, 2 pgTAP grandes, Edge TS de cancelación/reembolso/webhook sin commit en el worktree) es borrador sin revisar |
| Autorización | `INCOMPLETE` | Matriz RLS de 838 celdas integrada (`d1cb1ca`, CI verde). El paquete wp19 (AUTHZ-04 cancelación por catálogo de permisos + refusals 42501; 2 migraciones `20261002050000-051000` + 9 copias de tests) es borrador sin revisar |
| Recuperación de entregas y alertas | `INCOMPLETE` | Paquete wp11 (2 migraciones `20261002010000-011000` + 3 pgTAP) borrador sin revisar |
| Certificación del stack | `INCOMPLETE` | El arranque del stack efímero es real y verde (run 37067129076). El certificador `--target stack` y los cambios al workflow están sin commit y nunca corrieron en CI |

#### Estado actual de los cinco frentes (09:40)

| Frente | Estado | Evidencia |
|---|---|---|
| Idempotencia | `PASS` (local + CI en curso) | `3007ed39`: 4 migraciones; la carrera queda en el gate. Local, orden del CI: `GLOBAL_IDEMPOTENCY: PASS`, 754 llamadas, 0 deadlocks, 0 esperas agotadas; sin los arreglos FAIL con 7 defectos y 14 deadlocks. Revisión adversarial: aprobada con notas. Abiertos (registro): IDEM-07, IDEM-08 |
| Pagos | `PASS` (local + CI en curso) | `cf0d30fb`: 4 migraciones + Edge `mercadopago-cancel-payment`; pgTAP 210 + 202 + 46 + 90; Deno 52 + 387. Revisión: sin defectos en los caminos de dinero. **Nuevo P1 PAY-PROBE-01** corregido en `5c578793` (sondas del proveedor), con evidencia viva de Staging |
| Autorización | `PASS` en código; aplicación `BLOCKED` (dueño) | `4cee8a74`: AUTHZ-04 cancelar/rechazar por catálogo + C-1 42501; matriz 796; seis scripts de CP/Staging pasan a cancelar como dueño. Aplicarla en un entorno cambia lo que puede hacer un empleado (también en una caja de Caja Clara): OWNER_APPROVAL_REQUIRED |
| Recuperación de entregas y alertas | `PASS` (local + CI en curso) | `4a4afa79` + `34460beb` (la reversión devolvía mal un permiso: hallado por el ensayo de la cadena). pgTAP 162 + 101; pruebas de alertas en verde también con una tarea programada apagada |
| Certificación del stack | `INCOMPLETE` | Las migraciones aplican en un Supabase real efímero en cada push (runs 37122427290 y 37122606379 verdes; 37123390697 en curso). El certificador `--target stack` sigue sin commit: es el próximo frente |

Verificación local completa sobre el HEAD `a7eb622c` (PG17 + shims): 203/203 migraciones; pgTAP 74/74 archivos, 5.865
aserciones, total consistente (base limpia y base «sucia»); carreras admisión/stock/idempotencia PASS; cadena de 45 reversiones
0 fallidas, 0 diferencias contra una línea base de 158 armada en el momento; mínimo privilegio sobre el esquema viejo PASS;
`npm run check` PASS; 885 tests de Node relevantes PASS. CI completo despachado: run 37123390677.

#### Riesgos iniciales

1. Nada de los 5 frentes está integrado: un agente nuevo que lea «cinco validaciones exitosas» puede creer que hay más hecho de lo que hay.
2. Staging no tiene ninguna de las 32 migraciones de la rama: el comportamiento endurecido nunca corrió sobre Staging.
3. La línea Caja Clara (otra sesión) agrega su propia migración a Staging; aplicar primero las de esta rama obliga a seguir el contrato de `docs/ecommerce-hardening/staging-coexistence.md`.
4. La PC se apaga ~13:27: todo lo que valga tiene que estar commiteado y pusheado antes.
5. Memoria y CPU acotadas: como máximo 2–3 procesos pesados a la vez, sin gates de fondo de larga vida.

### Bitácora (sesión 1)

- 08:40 — checkpoint inicial; preflight de sólo lectura en Staging y CP (21/21, integridad 0). Push `591e06d0` (incluye `47d9ffe9`).
- 08:38–08:50 — verificación local (PG17 + shims, NO es un stack de Supabase) de los cuatro paquetes SQL juntos sobre el repo
  (wp11 + wp13 + wp18 + wp19, 202 migraciones):
  - pgTAP: 72/73 archivos, 5.831 aserciones planificadas. Única falla: `order_cancellation_panel_and_tracking_test.sql` (nuevo de
    wp13) hace cancelar a un empleado, y wp19 (decisión del dueño AUTHZ-04) exige `orders.cancel`, que el empleado no tiene →
    conflicto entre paquetes, se adapta el fixture al integrar.
  - Carreras en el orden del gate: admisión PASS (4), stock PASS (12, 0 deadlocks; con la copia de wp19 del arnés, que cancela
    con un encargado en vez de un empleado), idempotencia **`GLOBAL_IDEMPOTENCY: PASS`** (758 llamadas, 0 deadlocks, 0 esperas
    agotadas).
  - Prueba discriminante: el mismo arnés sobre el repo SIN los paquetes da **`GLOBAL_IDEMPOTENCY: FAIL`, 7 defectos, 14
    deadlocks** (incluye la respuesta del proveedor y el aviso de pago cortados por 40P01 en la cancelación de pagos).
    Evidencia: `artifacts/taba-autonomous-20261003/races/{all,base}-*.txt`.
  - Tests unitarios del certificador y del arnés: 34/35 (la falla es la esperada: el arnés todavía no está cableado al gate).
- 08:42 — 4 revisores adversariales en paralelo (sólo lectura), uno por paquete. Sus informes: scratchpad de la sesión `review/`.
- 08:51 — compuerta de release en sólo lectura contra CP (`la-taba-cp`): **NOT_READY**, 9 bloqueos (catálogo 0/1, horarios,
  modo de entrega, equipo, decisión de cobro, 33 migraciones sin aplicar, 9 Edge Functions de Mercado Pago más viejas que el código,
  guardián de admisión ausente, CI) + gate externo EDGE-03. `artifacts/taba-autonomous-20261003/release-gates-cp-0851.*`.
- 08:52 — conciliación de sólo lectura contra Mercado Pago TEST en Staging (35 días): 31/32 conciliados y **1 CRÍTICO**: pago
  `179851082485` aprobado y acreditado en el proveedor (1800 ARS, 2026-09-25 17:04Z), intent `e5dbaf33…` «expired», sin pedido.
- 08:58 — **NUEVO P1 (PAY-PROBE-01), reproducido con datos vivos de Staging**: el barrido de verdad del proveedor corrió 8 veces
  (17:03–17:32Z) y las 8 respuestas fueron «vacío» (`payment.provider_probe_empty`), pero la misma búsqueda por
  `external_reference` con la credencial del vendedor devuelve el pago (GET de sólo lectura, total=1, aprobado, el dueño del token es
  el cobrador). La preferencia se creó con la generación de conexión `fd242d91…`; la conexión se re-enlazó a las 17:43Z
  (`6963ca5b…`). Después de 8 vacíos el barrido deja de preguntar, y la alerta `CHECKOUT_PROVIDER_UNVERIFIED` excluye
  explícitamente todo checkout con un sondeo vacío → **cobro sin pedido, sin alerta y sin más sondeos: invisible** salvo para la
  conciliación manual. Precondiciones: el aviso del proveedor no se procesó, el comprador no volvió, y la búsqueda vino vacía por
  algo que no es «no hubo pago» (credencial/conexión cambiada). Arreglo previsto (después de integrar wp11, que redefine la misma
  función de alertas): sondeos tardíos dentro de las 48 h y vacíos no concluyentes cuando la generación del vendedor cambió.
- Hallazgo a decidir: wp19 también exige `orders.cancel` para **rechazar**, y su propio encabezado avisa que la caja de **Caja
  Clara** opera con la sesión del cajero (si es empleado, deja de poder cancelar/rechazar) y que el Panel le sigue mostrando
  «Cancelar» a todo el equipo. AUTHZ-04 además nombra `authorize_arca_homologation` y `set_business_open_state`, que wp19 no toca.
- 09:00–09:15 — revisiones adversariales (sólo lectura): wp18 APROBADO con notas; wp11 APROBADO con notas; wp13 BLOCK sólo por
  empaquetado (no borrar `mercadopago_checkout_pro.local.sql`, actor del test, guardas de reversión); wp19 BLOCK sólo por guardas
  de reversión. Todo lo pedido quedó resuelto antes de integrar. Informes: scratchpad de la sesión `review/`.
- 09:20–09:35 — integrados y pusheados: `3007ed39` (wp18), `cf0d30fb` (wp13), `4a4afa79` (wp11), `4cee8a74` (wp19),
  `5c578793` (PAY-PROBE-01), `34460beb` (permiso en una reversión), `a7eb622c` (guarda de host de los arneses: `?host=` pisaba
  la URL local), `c5454a0c` (registro, verificación previa de la segunda tanda, plan de promoción corregido, convivencia).
- 09:28 — verificación previa nueva (`20261002_ecommerce_hardening_preflight.sql`) en Staging y CP: 12/12 sin error. En CP sólo
  hay empleados en comercios de QA (40 cancelaciones de `qa-cleanup.mjs` como empleado, ya cambiadas a dueño). En Staging el
  comercio de la línea Caja Clara canceló 24 pedidos como empleado: 20261002050000 NO se aplica en Staging sin acordarlo.
- Plan de promoción: decía que el cobro real lo abría `MERCADOPAGO_REAL_MONEY_ENABLED`, que no existe en el código; corregido. La
  llave real es el secreto smoke, y en CP no está (leído: sólo nombres de secretos).
- 09:40–10:02 — 5º frente: certificador e-commerce commiteado (`60a7f6ed`) y corriendo contra el Supabase efímero de CI.
  Corrida 1 (37123682507): el diagnóstico del workflow fallaba por un cast (`cd7a9e94`). Corrida 2 (37123838754): el preflight
  paraba porque el gateway del stack local no exige la clave del proyecto → «no probado en este destino» (`511dc88b`).
  **Corrida 3 (37124096351): 455 checks, 448 PASS, 3 FAIL, 4 no probados; las 24 fases corrieron sobre GoTrue, PostgREST,
  pg_cron y Edge reales.** FAIL reales: 55000 de negocio y P0002 de pedido inexistente salen como HTTP 500 (API-01/C-2,
  contrato HTTP abierto). El tercero era la misma diferencia de gateway (ajustado en `34f244a9`, sólo si no se filtró nada).
  Corrida 4 (37124837704) en curso.
- 09:45–10:00 — dos P2 de concurrencia más, reproducidos con las sondas de wp18 y corregidos:
  IDEM-08 (`c997a18c`): la marca de envío dudoso de la preferencia toma el cobro antes que el intento (X1/X2: 40P01 → sin
  deadlock). IDEM-07 (`e7287f53`, permisos corregidos en el commit siguiente): rechazar o retirar una oferta de reparto toma el pedido antes que la oferta (P4/P5:
  40P01 → las 7 sondas sin deadlock). El ensayo de la cadena de reversiones detectó que 062000 le sacaba el EXECUTE a
  service_role (que Staging y CP tienen): corregido; cadena 47/47, 0 diferencias.
- CI real sobre `a7eb622c` (run 37123390677): job de base de datos VERDE (migraciones como no-superusuario, pgTAP, carreras
  incluida la de idempotencia, restauración aislada) y Windows VERDE; el job web seguía corriendo.
- EDGE-03 (interruptor permanente del cobro real, opción A decidida por el dueño): un agente lo implementa en el worktree
  aislado `la-taba-real-money-gate` (rama `feat/taba-real-money-gate`, sin push); se integra sólo después de revisarlo.
  Verificado para su compuerta de release: la Management API devuelve por secreto `{name, value, updated_at}` con `value` =
  SHA-256 del valor, así que se puede saber si vale `enabled` sin ver nunca el secreto.
- 10:15 — **CI completo VERDE sobre `a7eb622c`** (run 37123390677: web/backend/fiscal/seguridad con `npm test` completo y E2E;
  migraciones + pgTAP + carreras + restauración; Windows). Corrida 4 del certificador en el stack (37124837704): 455 checks,
  448 PASS, **2 FAIL = API-01/C-2** (HTTP 500 en 55000/P0002, defecto real abierto), 5 no probados; el check nuevo de AUTHZ-04
  (empleado → 42501) pasó en el stack real. Más arreglos: TRACK-01 (`f02e55b2`, 39000 en la pantalla del pago tras recuperar el
  seguimiento). CI despachado sobre `011717fa`: run 37125497727; corrida 5 del stack: 37125278937.
- 10:20 — dos paquetes en worktrees aislados, SIN push, a revisar antes de integrar (si el apagado los corta, el avance queda en
  sus commits locales y en sus notas):
  - `la-taba-real-money-gate` (rama `feat/taba-real-money-gate`): EDGE-03 opción A, interruptor permanente del cobro real
    `MERCADOPAGO_REAL_MONEY_ENABLED` (sólo `enabled` abre; el cobro sigue cerrado por defecto) + compuerta de release
    `REAL_MONEY_GATE` + runbooks.
  - `la-taba-http-contract` (rama `feat/taba-http-contract`): API-01/C-2, las negativas 55000 y P0002 dejan de salir como HTTP
    500 (envoltura en el borde de la API; notas en `docs/ecommerce-hardening/http-contract-NOTES.md` de ese worktree).
- 10:35–10:45 — **EDGE-03 integrado** (revisado por mí antes de integrar): `6e7af1d4` (interruptor en Edge: sólo
  `MERCADOPAGO_REAL_MONEY_ENABLED=enabled` exacto abre el cobro real en producción, junto con la revisión aprobada y el vendedor
  conectado; además se cerraron dos huecos fail-open: la preferencia con intento nuevo re-reservaba stock antes de la compuerta),
  `297130a7` (compuerta de release `REAL_MONEY_GATE` / `MONEY_MOVEMENT_POSSIBLE` por huella), `cb7f60f2` (verificación de
  configuración), `d4e5fa13` (runbooks), `24b040c2` (registro: P1 14 corregidos / 0 abiertos; plan y acciones pendientes
  corregidos). Suites: Deno 52 + 452, `test:payments` 228/228, compuertas 146/146, `npm run check`. NO desplegado: CP sigue sin
  el secreto, así que el cobro real sigue cerrado. El worktree `la-taba-real-money-gate` ya está integrado (se puede borrar).
  Corrida 6 del stack: 37127204266.
- 10:50 — el CI completo sobre `889903da` (run 37127693255) falló en el job de base de datos (y se canceló el resto): el verificador independiente
  A1-A4 simula un entorno con el cobro real autorizado sólo con la variable vieja, y el handler nuevo (EDGE-03) contestaba
  `PAYMENT_UNAVAILABLE`. Corregido en `1470b3ff` (el entorno simulado también lleva el interruptor nuevo); CI 37128362175:
  base de datos y Windows VERDES.
- 11:00–11:15 — **contrato HTTP integrado (API-01 + C-2)**, revisado y verificado por mí antes de pushear: `ec818d12`…`d79992cf`
  (cherry-pick de los 8 commits del agente) + `ed86e3cb` (el check del certificador que clavaba el 500 pasa a exigir 409) +
  `63119fd8` (registro: API-01 corregido; P2 35/23) + `2bc7218a` (plan de promoción: guarda `ROLLOUT_BLOCKED`, cadena de 50).
  `20261002090000` envuelve 109 funciones de entrada: por la API, un 55000 sale como HTTP 409 y un P0002 como 404, con el mismo
  cuerpo; sin `request.method` o con un llamador PL/pgSQL, el error original. `20261002091000` les da su SQLSTATE a 46 negativas
  que salían como P0001 (15 aserciones de 6 tests cambian sólo el SQLSTATE esperado). Verificación local con 208 migraciones:
  pgTAP 78/78 y 5.938 (limpia y «sucia»), carreras PASS con 0 deadlocks, cadena **50/50, 0 diferencias**, mínimo privilegio
  sobre el esquema viejo PASS, conversión como la ve PostgREST 11/11 (`scripts/db/check-api-boundary.mjs`), Node 985/985,
  `npm run check` PASS. Las Edge Functions no deciden por el estado HTTP de una RPC (revisado): no cambian.
- 11:22 — **certificador en el stack sobre `2bc7218a` (run 37129059684): 455 checks, 450 PASS, 0 FAIL, 5 no probados** (4 no
  disponibles en el destino + umbrales de rendimiento sin versionar). Los dos FAIL de API-01/C-2 pasan: la negativa 55000
  contesta 409 y el «no existe» 404, con el mismo cuerpo, por un PostgREST real. Las 208 migraciones aplicaron en el Supabase
  efímero sin que la guarda `ROLLOUT_BLOCKED` frenara nada. Evidencia: `artifacts/taba-autonomous-20261003/stack-certification-run-37129059684/`.

### Segunda pasada de la sesión 1 (11:20–11:30, obligatoria)

Cada frente se volvió a mirar contra evidencia nueva, no contra lo que dijo la primera pasada:

- **Idempotencia**: la carrera global sobre el árbol final (208 migraciones, orden del CI): `GLOBAL_IDEMPOTENCY: PASS`,
  0 deadlocks; idempotencia en el stack 27/27. Sin cambios de estado.
- **Pagos**: lectura viva de sólo lectura en Staging y CP (11:20): trabajos de pago muertos, cancelaciones trabadas, disputas y
  dinero devuelto con stock tomado, todo en 0, igual que a las 09:28. Compuerta de CP repetida (11:25): `MONEY_MOVEMENT_POSSIBLE: NO`.
  Pagos 12/12 y ACK perdido 11/11 en el stack final.
- **Autorización**: el contrato HTTP no toca los 42501 (401/403); la app Rider sólo reintenta o cierra sesión ante 401/400/403,
  y el Panel decide conflictos por el código (PT409), no por el estado: un 409 de negocio no se confunde con un conflicto de
  revisión. AUTHZ-04 sigue esperando al dueño.
- **Entregas y alertas**: 0 entregas en curso y tareas programadas activas en los dos entornos; cadena de reversiones 50/50.
- **Stack**: 0 FAIL por primera vez (antes 2, API-01/C-2).

Lo que encontró la segunda pasada: nada nuevo del producto. Dos errores míos, corregidos: corrí un subconjunto de Node sin
`--import ./tests/test-bootstrap.mjs` (2 fallas falsas en `address-flow`; con el bootstrap, 985/985), y anoté un número de corrida
de CI equivocado en esta bitácora (corregido antes del commit). Y se cerró un pendiente de herramientas del registro: **TOOL-05** (`npm test` reescribía `ci.yml` y `config.toml` en el lugar; ahora la prueba usa copias, `94479254`). Registro: P2 36 corregidos / 22 abiertos.

#### Estado final de los cinco frentes (sesión 1)

| Frente | Estado | Evidencia |
|---|---|---|
| Idempotencia | `PASS` | `3007ed39`, `c997a18c` (IDEM-08), `e7287f53` (IDEM-07); carrera global PASS con 0 deadlocks en local y en el gate del CI; stack 27/27 |
| Pagos | `PASS` hasta donde se puede sin dinero real | `cf0d30fb`, `5c578793` (PAY-PROBE-01, P1), EDGE-03 integrado (no desplegado); stack: pagos 12/12, ACK perdido 11/11; CP falla cerrado |
| Autorización | `PASS` en código · aplicación `BLOCKED` (dueño) | `4cee8a74` (AUTHZ-04 + C-1); AUTHZ-04 en vivo en el stack (empleado → 42501); aplicarla en un entorno es OWNER_APPROVAL_REQUIRED |
| Recuperación de entregas y alertas | `PASS` | `4a4afa79`, `34460beb`, `f02e55b2` (TRACK-01); cadena de 50 reversiones sin diferencias |
| Certificación del stack | `PASS` | certificador en CI sobre un Supabase efímero: 455 checks, 450 PASS, 0 FAIL (37129059684), con el contrato HTTP integrado (`ec818d12`…`ed86e3cb`) |

- 11:40 — **DIAG-03 confirmado en vivo (sólo lectura)**: `scripts/production-health-check.mjs` cuenta las alertas con `severity = 'critical'` y la tabla sólo admite `'CRITICAL'`: Staging tiene 23 alertas CRITICAL históricas que la sonda nunca vería; además exige exactamente 4 tareas `taba-*` (CP ya tiene 5). El arreglo de la severidad es de una línea; no se hizo porque la sesión se cortó por límite de uso (habría necesitado otro CI). Retargetear la sonda a CP es DIAG-10.
- 11:40 — sesión cortada por límite de uso. CI final 37129892043 sobre `59fa86b8` en curso: la próxima sesión verifica su resultado.

## PC principal — recuperación verificada y continuación de salud (2026-10-03)

- Recuperación de la PC: PASS / READY_TO_CONTINUE YES. El worktree base quedó limpio en `6fd0b6f48bc105bd153ffe6f0d7a4af6daa6115a`; frontend independiente en `737371ba82cae6e309cff04c97984443c52c8def`. Los cinco checks del backend transferido y los tres del frontend terminaron SUCCESS. El reporte e inventarios están en la rama `handoff/main-pc-recovery-20261003`.
- Origin avanzó tres commits hasta `dfedfcc1` durante la auditoría (PAY-PROBE-08 y DIAG-14); se registró el delta sin modificar el worktree fijado al handoff ni mezclar frontend. Esta continuación va en `hardening/main-pc-health-readonly-20261003`, basada en el SHA transferido.
- Validación inicial Windows: 124/125 tests focalizados; la falla era `SCRIPT.pathname` en el test CLI de salud. Las dos verificaciones funcionales pasaron con ruta portable y acceso de red bloqueado. Corregido el test con `fileURLToPath`; la suite de salud pasa 11/11.
- DIAG-10, parte Auth: destino explícito compartido con la sonda de base; CP toma su negocio del manifiesto y staging exige UUID. Las consultas usan el endpoint con rol de sólo lectura; importar el módulo no ejecuta nada. Doce tests nuevos usan respuestas simuladas; también validan el destino al usar la sonda como biblioteca. El watchdog externo sigue OPEN / OWNER_APPROVAL_REQUIRED (Owner 7). No se consultó ni modificó ningún entorno alojado, ni se ejecutó un cobro o despliegue.
