# Checklist guiada — Moto G15 / staging TABA2 Rider

Precondiciones: exactamente un Moto G15 autorizado por ADB; APK `com.lataba.rider.staging` con SHA-256 registrado; cuenta y pedido sintéticos de staging autorizados. Nunca usar producción ni datos comerciales.

| Paso | Acción | Resultado esperado | Registrar |
|---|---|---|---|
| 1 | Instalar con `adb install -r` el APK staging identificado. | Instalación correcta; no se toca otra variante. | Hash y versión, sin serial. |
| 2 | Abrir desde launcher. | Nombre visible **TABA2** y login **TABA2 Rider**; sin crash. | Captura sanitizada. |
| 3 | Escala de fuente 100 %, 130 % y máxima razonable. | Sin texto esencial truncado, overflow ni CTA inaccesible. | PASS/FAIL por escala. |
| 4 | Iniciar sesión con cuenta staging rider válida. | Cola real autorizada, membership válida; errores legibles si falla. | Resultado sin email. |
| 5 | Abrir una card disponible y reclamar una vez. | “Reclamando” bloquea doble toque; sólo servidor confirma. | Resultado del pedido sintético. |
| 6 | Repetir claim desde segundo actor/sesión. | Un ganador; el otro ve conflicto y no asignación local. | Ganador/perdedor sin IDs. |
| 7 | Iniciar entrega. | Explicación previa; Android pide ubicación/notificaciones sólo cuando se necesitan. | Aceptado/rechazado. |
| 8 | Rechazar ubicación. | Sin loop técnico; mensaje accionable y “Abrir Ajustes”; no se finge GPS. | PASS/FAIL. |
| 9 | Conceder permisos, encender GPS y empezar entrega. | Foreground service y notificación TABA2; estado “Buscando” hasta fix real. | Estado, sin coordenadas. |
| 10 | Caminar/rodar en exterior con GPS real. | Sólo luego de fix/publicación reciente aparece GPS activo; sin “en vivo” inventado. | Inicio/fin y resultado. |
| 11 | Cubrir señal o usar precisión baja. | Estado GPS débil/sin señal; no se marca como activo. | PASS/FAIL. |
| 12 | Apagar GPS. | “Ubicación del teléfono apagada”, sin crash ni confirmación falsa. | PASS/FAIL. |
| 13 | HOME, volver, apagar/encender pantalla y recrear actividad. | Entrega activa se recupera desde estado autorizado; sin watcher duplicado. | PASS/FAIL. |
| 14 | Alternar Wi-Fi/datos, modo avión y reconectar. | Datos visibles permanecen; cola/acción pendiente se informa; reconsulta al reconectar. | PASS/FAIL. |
| 15 | Con app en background y pantalla apagada. | Notificación breve sin dirección/código; abre la app al tocarla. | PASS/FAIL. |
| 16 | Force-stop y reapertura (sin `pm clear`). | No crash; recuperación depende del estado servidor autorizado. | PASS/FAIL. |
| 17 | Terminar la transición terminal sólo si el backend ofrece la API aprobada. | Servicio GPS se detiene únicamente tras confirmación de servidor. | No ejecutar sin RPC. |
| 18 | Capturar logcat sanitizado. | Sin `FATAL EXCEPTION`, `AndroidRuntime`, `ANR` ni `FlutterError`. | Archivo redactado. |

La certificación de GPS físico requiere los pasos 9–16 con recorrido real; una ubicación simulada o una prueba indoor no es sustituto.
