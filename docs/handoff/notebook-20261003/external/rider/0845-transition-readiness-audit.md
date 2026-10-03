# Auditoría de readiness de transiciones — smoke Rider

Inventario sobre `androidTest/.../qa/` en `366a0b5`, antes del arreglo.

## El patrón, no el caso

La corrida `85751d1b` murió en `openQaOrder()`. Pero el inventario muestra que
**no es un caso: es un patrón repetido diez veces**. Cada fase abre el pedido y
lee el estado en la línea siguiente.

`screen.act()` devuelve en cuanto detecta un cambio en la firma del árbol
—cantidad de nodos, longitud del texto—. Ese cambio ocurre cuando *arranca* la
navegación. Todo lo que se lea inmediatamente después mira una pantalla a medio
construir.

## Carreras encontradas

| Fase | Estado inicial | Acción | Señal insuficiente actual | Señal real de readiness | Timeout | Clasificación |
|---|---|---|---|---|---|---|
| 1 PREFLIGHT_AND_QUEUE | ready | tocar el pedido | `act()` devuelve al primer cambio de firma; `observeState()` en la línea siguiente | detalle con marcador propio + exactamente un CTA accionable + sin cargando + firma estable ×2 | 25 s | **CARRERA — mató la corrida** |
| 2 PRECLAIM_PRIVACY | ready | abrir detalle | idem, y además lee el texto de pantalla para privacidad | igual que 1, antes de leer la pantalla | 25 s | **CARRERA** |
| 3 CLAIM_AND_POSTCLAIM | ready | `act(Aceptar pedido)` | `awaitText(Confirmar retiro)` sí espera, pero la lectura de dirección exacta va después sin barrera propia | CTA `Confirmar retiro` accionable + `Aceptar pedido` ausente + estable | 25 s | **CARRERA parcial** |
| 4 PICKUP_AND_START | assigned | `act(Confirmar retiro)` → `act(Iniciar recorrido)` | encadena dos acciones mutantes; la segunda se dispara sobre pantalla no verificada | readiness entre ambas, con CTA anterior ausente | 25 s / 30 s | **CARRERA** |
| 5 MAP_CONTROLS_AND_NAV | on_the_way | `act(Recentrar)`, `act(Abrir en Google Maps)`, `launchApp()` | `SystemClock.sleep(3_000)` como única prueba de que Maps abrió y de que volvimos | package foreground correcto + Activity + detalle reconstruido | 15 s | **CARRERA + sleep como aserción** |
| 6 RESUME_AFTER_LIFECYCLE | on_the_way | volver de background/pantalla | `openQaOrder()` sin verificar que la Activity reanudada ya renderizó | foreground + sesión + entrega + CTA accionable + estable | 25 s | **CARRERA** |
| 7 OFFLINE_ACTION | on_the_way | observar sin red | `openQaOrder()` inmediato | readiness de detalle con red caída confirmada | 25 s | **CARRERA** |
| 8 POST_RECONNECT | on_the_way | observar tras reconectar | `openQaOrder()` inmediato; no espera fin de sincronización | readiness + señal de sincronizado | 30 s | **CARRERA** |
| 9 ARRIVAL_AND_CODE | on_the_way | `act(Llegué)` → `act(Ingresar código)` → `setText` | `editableNodes().lastOrNull()` inmediatamente después del scroll/foco | campo presente, enfocado y accionable antes de escribir | 25 s | **CARRERA** |
| 10 TERMINAL_DELIVERY | arrived | `act(Confirmar entrega)` | `awaitTextGone` sí espera; el segundo submit se evalúa tras `sleep(2_000)` | estado terminal estable + CTA mutante ausente ×2 sondeos | 30 s | **CARRERA parcial + sleep** |

**Diez de diez fases** leen estado sin barrera de readiness completa.

## Sleeps: clasificación

| Ubicación | Valor | Clasificación |
|---|---|---|
| `QaScreen` 55, 64, 152, 163 | 200–300 ms | **intervalo de polling** — legítimo |
| `QaScreen` 139 | 90 ms | **espera física** entre DOWN y UP del MotionEvent — legítimo |
| `QaScreen` 183 | 500 ms | **debounce** tras `ACTION_SET_TEXT` — legítimo, pero se le agrega verificación |
| `RiderSmokePhaseTest` 87 (`launchApp`) | 6000 ms | **DEUDA** — era la única prueba de que la app estaba lista |
| `RiderSmokePhaseTest` 102 | 800 ms | debounce tras tocar refresh — legítimo |
| `RiderSmokePhaseTest` 108 | 500 ms | intervalo de polling — legítimo |
| `RiderSmokePhaseTest` 288 | 3000 ms | **DEUDA** — única prueba de que Google Maps abrió |
| `RiderSmokePhaseTest` 390 | 2000 ms | **DEUDA** — única prueba de que el estado terminal se asentó |
| `RiderSmokePreflightTest` 54 | 6000 ms | **DEUDA** — mismo `launchApp` |

Cuatro deudas. Ninguna se resuelve subiendo el número: eso esconde la carrera en
vez de cerrarla.

## Definición de readiness adoptada

Una pantalla está lista sólo cuando se cumplen las siete condiciones a la vez:

1. sus marcadores obligatorios están presentes;
2. los marcadores incompatibles de la pantalla anterior ya no están;
3. el CTA esperado existe;
4. ese CTA es accionable (`isEnabled` y con acción de click);
5. hay **exactamente uno** de los CTA principales del vocabulario;
6. la **firma semántica normalizada** se repite en dos observaciones seguidas;
7. no hay indicador de carga activo.

La firma es semántica y no el árbol completo: se normaliza a marcadores
conocidos, presencia y estado de cada CTA, y presencia de campos editables. El
árbol completo es inestable por relojes, badge de frescura del GPS y
animaciones, así que exigir su estabilidad daría falsos negativos eternos.

Los indicadores de carga se derivan del código real: las etiquetas ocupadas
terminan en `…` (`Tomando pedido…`, `Confirmando retiro…`, `Iniciando
recorrido…`, `Registrando llegada…`, `Confirmando entrega…`) más `Verificando
código`.

## Contrato de acciones mutantes

1. readiness de entrada;
2. la acción se dispara **una sola vez**;
3. checkpoint `ACTION_DISPATCHED`;
4. espera observable de la transición;
5. comprobación local;
6. comprobación remota cuando corresponde;
7. checkpoint `TRANSITION_CONFIRMED`.

Si la espera vence **no se vuelve a tocar el CTA**. Se consulta el estado, se
clasifica y se corta. Un timeout no autoriza un reintento: el backend puede
haber aplicado la mutación y el segundo toque la duplicaría.
