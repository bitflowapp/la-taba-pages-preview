# TABA Rider Android — Estrategia de ubicación

## Regla que gobierna todo

**La ubicación se emite únicamente entre `picked_up` y `delivered`.** Fuera de esa ventana el servicio está detenido y el servidor rechaza los puntos. No es una optimización de batería: es el compromiso de privacidad con el rider.

## Arquitectura

```
LocationForegroundService (nativo Android)
   ├─ FusedLocationProvider / geolocator
   ├─ Filtro de calidad
   ├─ Buffer local (Drift)
   └─ Envío por lotes → rpc_push_locations
            ↓ falla
       Outbox (durable)
```

El servicio es **nativo con notificación persistente** (`flutter_foreground_task`). Es la única forma de que la posición siga emitiéndose con la pantalla apagada y la app en segundo plano en Android 13–15. Con `WorkManager` no alcanza: la frecuencia mínima es de 15 minutos.

## Permisos

| Permiso | Cuándo se pide | Si se deniega |
|---|---|---|
| `ACCESS_FINE_LOCATION` | Al confirmar el primer retiro, **con explicación previa en pantalla** | No se puede confirmar el retiro; se explica por qué y se ofrece ir a Ajustes |
| `FOREGROUND_SERVICE_LOCATION` (API 34+) | En el manifiesto | — |
| `POST_NOTIFICATIONS` (API 33+) | Al iniciar el primer turno | La app funciona, pero se avisa que no llegarán pedidos nuevos |
| `ACCESS_BACKGROUND_LOCATION` | **No se pide** | — |

**No se solicita ubicación en segundo plano.** El foreground service cubre el caso de uso completo, evita una pantalla de permiso que la mitad de los riders rechaza, y elimina una revisión adicional en Play Store.

## Frecuencia por estado

| Estado | Intervalo | Distancia mínima | Precisión |
|---|---|---|---|
| Sin pedido / turno cerrado | **Servicio detenido** | — | — |
| `assigned` (yendo al local) | Sin emisión | — | — |
| `picked_up` | 15 s | 30 m | `high` |
| `on_the_way` | **10 s** | 25 m | `high` |
| `arriving` (< 300 m) | 5 s | 10 m | `best` |
| Detenido > 2 min (velocidad ≈ 0) | 60 s | 50 m | `balanced` |

El paso a modo detenido es el mayor ahorro real: un rider esperando en la puerta no necesita 10 s.

## Filtro de calidad

Se descarta un punto si:
- `accuracy > 100 m`;
- implica una velocidad > 130 km/h respecto del anterior (salto por triangulación);
- está a menos de 8 m del anterior y hace menos de 5 s;
- su `timestamp` está en el futuro o más de 2 h en el pasado.

Los descartes se cuentan como métrica de calidad, no se registran individualmente.

## GPS obsoleto

Sin punto válido por más de **90 s** durante `on_the_way`: la app muestra “Ubicación imprecisa” en la franja de estado, y el cliente ve el último punto conocido con su hora, **nunca una posición inventada ni interpolada**.

Sin punto por más de **5 min**: se avisa al local. El rider puede seguir trabajando con normalidad — la entrega no depende del GPS.

## Ubicación simulada

`Position.isMocked` → el punto se envía con `src: "mock"`, se registra en la auditoría y se alerta al negocio. **No se bloquea al rider desde el dispositivo**: la decisión es del local, con la evidencia delante.

## Offline

Los puntos se guardan en Drift con el `order_id`. Al recuperar señal se envían en lotes de hasta 60, **en orden temporal**. El servidor acepta puntos con antigüedad de hasta 2 horas: el seguimiento del cliente se rellena hacia atrás y la ruta queda completa aunque hubiera zonas ciegas.

Si la cola de puntos supera 2.000, se diezma conservando 1 de cada 3 puntos intermedios y **todos** los extremos y cambios de estado: la ruta pierde resolución, no forma.

## Batería

| Medida | Efecto |
|---|---|
| Servicio detenido fuera de la ventana de entrega | El mayor ahorro: la mayor parte del turno no emite |
| Modo detenido a 60 s | Ahorro grande en esperas |
| Envío por lotes, no punto a punto | Menos despertares de radio |
| Sin wake lock adicional | El foreground service alcanza |
| Mapa sólo en pantallas de ruta | Evita render continuo |

Objetivo: **< 8 % por hora** con ubicación activa en el dispositivo de referencia. Se mide con `Battery Historian` sobre un turno real antes de habilitar el despliegue.

Si el sistema entra en ahorro extremo, Android puede matar el servicio: se detecta al reanudar, se avisa al rider y se pide excluir la app de la optimización de batería con una explicación clara.

## Cierre del seguimiento

Al confirmarse `delivered`, `cancelled` o `failed`:
1. Se detiene el servicio y se cancela la notificación persistente.
2. Se envían los puntos pendientes.
3. Se borra el buffer local de ese pedido.
4. El cliente deja de ver la posición del rider **de inmediato**.

## Privacidad — lo que se le promete al rider

- La ubicación se comparte **sólo** mientras lleva un pedido.
- Se ve en `home` si está activa y por qué.
- La notificación persistente lo dice explícitamente.
- Los puntos se conservan **7 días**; después queda la ruta resumida del pedido.
- Ningún rider ve la posición de otro.
- El local ve la posición **de sus entregas en curso**, no un historial de movimientos del rider.

Esto debe estar escrito en la app, en `Perfil → Privacidad`, en castellano llano. No en una política de 20 páginas.
