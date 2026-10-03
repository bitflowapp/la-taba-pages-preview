# ANDROID_LIFECYCLE_MATRIX — Garantías, límites y pruebas

## Principio

Un ForegroundService de tipo location permite continuidad con pantalla apagada cuando el usuario lo inicia correctamente desde una Activity visible, existe permiso de ubicación precisa, hay una notificación y el sistema/OEM no fuerza una terminación. No es una garantía de supervivencia ante force-stop, batería retirada, desinstalación o todas las políticas OEM. La arquitectura debe conservar datos y hacer recuperación explícita.

| Evento/estado | Garantía razonable | Implementación requerida | Prueba física/evidencia |
|---|---|---|---|
| App visible, start | Se puede pedir permiso y promover el servicio inmediatamente. | Validar fine + notification, startForegroundService y startForeground temprano; capturar errores de start. | Start/stop repetido, doble tap, dos órdenes y screenshot de estado. |
| Home/otra app | El FGS location puede continuar con pantalla apagada. | FGS location, FLP nativo, notification ongoing, uploader nativo. | Recorrer ruta 20 min con app no visible; comparar captured_at/recorded_at. |
| Pantalla apagada/lock | Esperar callbacks mientras el FGS siga activo; no prometer frecuencia exacta. | No depender de Flutter; política de batería y queue. | Lock/unlock; medir freshness, batería y gaps. |
| Swipe de Recents | stopWithTask=false y onTaskRemoved sin stop sugieren continuidad, pero OEM puede variar. | Mantener política explícita y detector de service stopped; no limpiar active intent por accidente. | Swipe, esperar 10 min, revisar notification/server sequence; repetir tras cold reopen. |
| Doze/battery saver | El FGS no elimina todas las restricciones; puede haber retraso. | Cola durable, edad máxima, estados Delayed/Stale, sin loops de red. | Battery saver/Doze, comprobar que no hay ANR y que retorna a Fresh. |
| Red perdida | Captura local acotada; ningún request hasta recuperar red/backoff. | Room encrypted queue, NetworkMonitor, lease y retry. | Airplane mode 15 min, kill/reopen, quitar modo avión, medir drain. |
| Red vuelve | Drenar sin duplicar workers ni perder muestras. | Singleton uploader por rider scope y WorkManager acotado. | Toggle de red varias veces; contar ACK/sequence. |
| Proceso muerto por sistema | Puede haber recreación de START_STICKY, no se garantiza; metadata/queue sobreviven. | Persist active delivery intent cifrado; en onCreate/onStartCommand recuperar y reconciliar. | adb shell am kill o equivalente permitido, reabrir/esperar y revisar estado. |
| App process crash | No usar estado solo en memoria. | RecoveryPolicy, lease recovery, service event, pantalla de recovery. | Crash controlado durante captura y durante upload. |
| Teléfono reiniciado | No prometer auto-resume de location FGS sin política y evidencia. | Receiver solo si la política Android/OEM lo permite; preferir notificación “Reanudar entrega” y reconciliar al abrir. | Reboot con entrega activa; documentar resultado, sin llamar PASS si requiere tap. |
| APK actualizado | Servicio/proceso puede reiniciarse y Room migrar. | Migration tests, active intent versionado, recovery al primer launch. | Upgrade sobre staging, conservar queue y no duplicar start. |
| Force-stop | Android puede suprimir componentes/jobs y no permite recuperación automática hasta apertura explícita. | Marcar estado desconocido; no prometer seguimiento. Mostrar recuperación al abrir. | Settings > Force stop; comprobar que no hay auto requests; abrir y recuperar. |
| Task Manager “Stop” | Es un stop explícito del sistema; no auto-restart. | Tratarlo como tracking stopped; orden backend queda separada; app debe permitir reanudar solo con confirmación y revision fresca. | Android 13+ Task Manager stop, verificar notification/queue/order. |
| Detener desde notificación | Debe detener captura local, no completar/cancelar la orden. | Acción con texto “Pausar seguimiento”; limpiar/retener según policy y emitir reason user_stop. | Tap, cerrar notificación, abrir app, verificar orden todavía assigned/on_the_way. |
| Permiso fine revocado | No continuar fingiendo frescura. | Callback/estado de permission, stop capture, preserve safe recovery metadata, UI accionable. | Revocar while active; verificar stop y mensaje. |
| Solo COARSE | No es calidad suficiente para tracking operacional. | Bloquear start/publication y llevar a Settings/permission rationale. | Conceder approximate únicamente; confirmar que no se publica. |
| Notificación denegada | FGS puede tener visibilidad reducida, pero el producto necesita awareness. | Decisión explícita: fail closed para rider o estado limitado aprobado; no ocultar un servicio activo. | Android 13 permission deny/allow, revisar Task Manager/drawer. |
| Proveedor GPS apagado | No hay fix; el servicio no debe reportar Fresh. | LocationSettings check, estado No signal y guía accionable. | Desactivar Location, mantener entrega, reactivar. |
| Sesión expirada | Captura puede detenerse o encolarse temporalmente, pero no publicar sin token válido. | SessionManager refresh single-flight; session_required y no secrets. | Expirar token/mock 401 durante red y offline. |
| Orden/revision cambia | Publicaciones antiguas se rechazan o deben detenerse. | Reconciliar assigned/revision; queue partition por revision; no asumir éxito local. | Cambiar estado/revision en staging controlado. |
| Orden terminal | Detener tracking y cerrar cola. | Stopper centralizado por delivered/cancelled/failed. | Completar desde otro actor, luego abrir/reanudar rider. |

## Semántica de estados visible

- Starting: se está promoviendo el FGS y buscando fix.
- Running/Fresh: servicio activo y última publicación server-side dentro de 30 segundos.
- Running/Delayed: servicio activo, última aceptación entre 30 y 120 segundos.
- Stale/No signal: no hay ubicación reciente; acción para revisar permiso, GPS o red.
- Queued: hay muestras cifradas pendientes.
- Session required: no se puede publicar sin reautenticación.
- Paused by user/system: seguimiento detenido; orden backend no se modifica automáticamente.
- Error: reason code con retryable y acción.

El estado técnico del servicio no debe confundirse con el estado comercial de la orden.

## Protocolo de recuperación

Al iniciar app o servicio:

1. Leer active delivery intent cifrado y queue metadata.
2. Validar versión, rider scope y permiso.
3. Consultar la orden asignada con el método existente; no crear RPC de recovery.
4. Si la orden ya no pertenece al rider, limpiar captura/queue de esa orden.
5. Si está asignada/en ruta y la sesión es válida, ofrecer o ejecutar recuperación según la política aprobada.
6. Revalidar revision antes de publicar.
7. Emitir un único snapshot completo a Flutter; eventos siguientes son cambios.

## Criterios de no-promesa

No afirmar “tracking garantizado” para reboot, force-stop, OEM battery killer, permiso revoked, app uninstall, teléfono apagado o ausencia prolongada de red. El copy operativo debe decir “seguimiento activo mientras el servicio y el dispositivo estén disponibles” y mostrar frescura real.

Referencias:

- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- https://developer.android.com/develop/background-work/services/fgs/launch
- https://developer.android.com/develop/background-work/services/fgs/changes
- https://developer.android.com/develop/sensors-and-location/location/permissions
- https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work
