# Mapa del Rider · métricas en el Moto G15 (ZY32LHS6PS, 60 Hz, presupuesto 16,67 ms)

Fuente: `dumpsys SurfaceFlinger --latency` sobre la capa
`SurfaceView[com.lataba.rider.staging/...](BLAST)`. `gfxinfo` no sirve: Flutter
dibuja en su propio SurfaceView y HWUI reporta 0 frames.

Escenario común: rider con **tres entregas activas** (MO-A, MO-B, MO-C) contra el
backend descartable `f4d5bc8`. Mismo aparato, misma sesión, mismos gestos
guionados por `adb`.

| escenario | BEFORE (`e1529ac`) | AFTER 1 (`e3fd7cf`) | AFTER 2 (`40f0f0d`) |
|---|---|---|---|
| A · mapa quieto 30 s | 2,7 % jank · máx 33,3 ms | 2,9 % · máx 33,3 ms | (no capturado) |
| B · zoom ×10 | 1,9 % · máx 33,3 ms | 9,4 % · máx 33,3 ms | (sin frames) |
| C · pan continuo | 0,0 % · máx 16,9 ms | (sin frames) | **0,0 % · máx 16,9 ms** |
| D · pan largo (≥3 refrescos) | 0,0–1,6 % · máx 33,3 ms | 0,0 % · máx 16,7 ms | **0,0 % · máx 16,8 ms** |
| E · abrir/cerrar detalle | 12,0–16,4 % · **máx 49,9 ms** | 15,2 % · máx 282,7 ms | 16,7 % · máx 182,8 ms |
| F · switch A/B/C ×20 | 12,3 % · **máx 66,6 ms** | 42,2 % · máx 282,6 ms | **14,9 % · máx 232,7 ms** |
| G · vuelta de background | 4,5 % · máx 49,9 ms | 0,8 % · máx 33,2 ms | **1,1 % · máx 99,8 ms** |
| H · lock / unlock | 1,6 % · máx 83,1 ms | (sin frames) | (sin frames) |

| contador | BEFORE | AFTER 2 |
|---|---|---|
| **superficies de mapa creadas** (sesión con 20 cambios) | **22** | **0** |
| superficies vivas a la vez | **2** | **1** |
| órdenes de cámara | 46 | 64 |
| rebuilds del home durante un pan largo | 4 | 3 |
| **memoria de gráficos** | **100.984 / 144.132 KB** | **34.576 KB** |
| Native Heap | 38.204 / 37.316 KB | 34.632 KB |

## Lecturas

* El mapa **quieto, el zoom y el pan estaban limpios desde antes** (0–2 % de
  frames largos). La librería no era el problema y no hay caso para migrarla.
* El jank vivía, por diez, en los dos escenarios que **creaban y destruían
  superficies**: abrir el detalle y cambiar de entrega.
* El arreglo de ciclo de vida elimina esa creación (22 → 0) y baja la memoria de
  gráficos a un tercio, pero al principio **empeoró** el cambio de entrega
  (42,2 %): al no haber transición de ruta, toda la pantalla se construía en un
  frame. Reutilizar el `State` del detalle lo devolvió a 14,9 %.
* Queda un pico por cambio de entrega (máx 232 ms contra 66 ms antes). El
  **ritmo** de frames largos es comparable al original y el mapa ya no se
  reinicia, pero el tirón en el instante del toque **no está cerrado**.

## De dónde sale el pico al cambiar de entrega (medido, no supuesto)

Con un build instrumentado con `Stopwatch`, sobre 9 cambios:

| tramo | mediana | máx |
|---|---|---|
| `_fitCamera` completo (incluye `fitCamera` + el `move` de encuadre) | **0,2 ms** | 0,5 ms |
| toque de selección → primer frame dibujado | 28,7 ms | 46,7 ms |

O sea: **la cámara no es el costo**, y la hipótesis del «doble movimiento de
cámara» queda descartada. El frame de selección son ~29 ms: un frame perdido,
no doscientos.

El pico se aisló por eliminación, con 12 aperturas de cada tipo:

| burst | máx | jank |
|---|---|---|
| abrir/cerrar **siempre la misma** entrega ×12 | **33,6 ms** | 44,0 % |
| abrir/cerrar **alternando** A/B/C ×12 | **199,6 ms** | 30,4 % |

Sin cambio de destino no hay pico. El pico es **el trabajo de tiles de la región
nueva**, y aparece sólo cuando el mapa tiene que mostrar otra parte del mundo.

Vale decir qué cambió y qué no: ese trabajo el código viejo **también lo pagaba**
—un mapa recién creado en el centro nuevo tenía que bajar y decodificar esos
mismos tiles—, pero ocurría detrás de la animación de la ruta que se empujaba,
así que el rider veía movimiento en lugar de un frame congelado. Hoy no hay
animación que lo tape. No se toca: reducirlo seria tuning especulativo del
renderer de la libreria, que es justo lo que este encargo pide no hacer.

## Gates físicos sobre el build FINAL (`5231a87`, sha `f11e4ec0…`)

Mismo Moto G15, misma sesión, backend descartable vivo (verificado por servidor
hasta el sweep de no-regresión inclusive). Evidencia: capturas `GATE-*.png`,
grabaciones `GATE-*.mp4` (tamizadas fotograma a fotograma: sólo datos de
fixture, sin notificaciones personales) y trazas `TABA_MAPDBG`.

| gate | resultado | evidencia clave |
|---|---|---|
| A · zoom ×10 en el detalle | **PASS** · 118 frames, p50 16,6 / p90 16,7 ms, jank 4,2 % | `GATE-A-zoom.mp4` |
| B · pan + 35 s quieto | **PASS** · «follow OFF (gesto del rider)» y ningún recentrado en 35 s con el board refrescando | `GATE-B2-pan.mp4`, capturas 1/2 idénticas |
| C · Centrar | **PASS** · «follow ON (Centrar)», un solo encuadre a ambos pines, 0,0 % jank | `GATE-C2-recenter.mp4` |
| D · GPS real | **PASS** · UN `RiderForegroundService`, 6 `publish_rider_location_fanout` en ~2 min, marcador vivo, 0 superficies nuevas | logcat + servidor |
| E · switch A/B/C ×20 | medido · 16,5 % jank, máx 465,7 ms; el mapa persiste y no hay contaminación entre pedidos | `GATE-E-switch.mp4` |
| F · background 30 s | **PASS** · 2,5 % jank, máx 66,5 ms, sin superficie nueva | `GATE-F-vuelta-background.png` |
| G · lock / unlock | **PASS con nota** (abajo) | `GATE-G-*.png` |
| H · force-stop / relanzar | **PASS** · restaura 3/3; la hoja de enrolamiento biométrico quedó sobre la barra de navegación (valida el P1) | `GATE-H-relanzado.png` |

Sweep de no-regresión multi-pedido sobre los bytes instalados: retiro → en
camino (permiso → navegación) → Llegué → PIN por UI → entregado → el hub cae
solo a 2/3 → oferta D visible con Aceptar/Rechazar sobre el pliegue, «1 bulto»,
«Cobrás ARS 4.000» → Rechazar por UI → el servidor confirma `rejected`, 2/3,
0 ofertas pendientes. Capturas `NR-1..7`.

### Gate G, contado entero

Ciclo real de pantalla: OFF 12 s → ON → desbloqueo. Sin mapa blanco
persistente, **cero** creaciones de superficie durante el ciclo (traza vacía) y
ningún controller duplicado — los dos criterios del gate. La nota: la app
volvió pidiendo login. Para ese momento el backend descartable llevaba horas
muerto (Docker se cayó por tercera vez entre el sweep y este gate), así que la
sesión no tenía contra qué validarse; además las huellas del equipo se borraron
al quitar el candado para poder automatizar los gates, y la sesión certificada
del Rider está respaldada por biometría. Ninguna de las dos causas es del mapa,
y el remonte frío del mapa ya lo probó el gate H por un camino más duro
(force-stop). No se pudo reloguear para la foto final: no queda API viva.

## Huecos de medición, declarados

Los «sin frames» no significan «no hubo dibujo»: el buffer de
`--latency` guarda 128 frames y la capa se recrea al volver de background o del
bloqueo, con lo que el nombre cacheado deja de existir. Se corrigió resolviendo
la capa justo antes de cada volcado, pero algunos escenarios quedaron sin
captura en alguna corrida. No se rellenaron con estimaciones.

Las grabaciones de los gates aparecieron «perdidas» al armar la evidencia: los
`adb pull /sdcard/...` de los scripts fallaban en silencio porque Git Bash
reescribe `/sdcard/` como `C:/Program Files/Git/sdcard/` (conversión de rutas
MSYS) y el error se iba a `/dev/null`. Se recuperaron todas con
`MSYS_NO_PATHCONV=1` y quedaron tamizadas y archivadas; la sdcard del Moto
quedó limpia.
