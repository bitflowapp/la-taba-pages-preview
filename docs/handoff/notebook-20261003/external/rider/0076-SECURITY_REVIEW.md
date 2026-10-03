# Revisión de seguridad del runtime

## Controles confirmados

- Tokens de sesión cifrados; metadata de delivery separada y mínima.
- Refresh single-flight y una única repetición controlada ante 401.
- Cierre de sesión cancela servicio, callbacks GPS y todas las llamadas activas antes de borrar credenciales.
- Cambio de rider no reutiliza un ciclo activo.
- Los errores de backend se traducen a categorías seguras; no se propaga cuerpo HTTP, SQLSTATE ni texto privado del transporte.
- El actor sólo admite como detalle visible de un reintento las claves locales `network_unavailable`, `rate_limited` y `orders_server_unavailable`; cualquier otra cadena se descarta.
- Snapshots/eventos no incluyen token, coordenadas, dirección ni identificador interno completo del pedido.
- `sequence` y `recorded_at` son autoridad del servidor; el cliente no los inventa.
- Payloads del bridge exigen versión 1 y estructura válida; datos incompletos fallan cerrados sin crash.
- La registración EventChannel se reemplaza de forma explícita para evitar filtraciones entre engines/listeners.
- El `operationId` es local y no altera el contrato RPC.

## Scan local al cierre

Se escanearon, sin imprimir contenidos, los 81 paths reportados por el worktree:

- literales con forma de JWT: 0;
- headers Bearer con valor literal: 0;
- asignaciones literales de password/refresh token/service role/anon key: 0.

Este scan es una defensa adicional y no sustituye un secret scanner corporativo. No se imprimieron valores de variables sensibles durante la auditoría.

El scan de sitios de logging en `android/app/src/main` y `lib` no encontró llamadas a `Log.*`, `Timber`, `println` ni `printStackTrace`. Además, los tests del codec y datasource verifican que detalles privados, tokens simulados, cuerpos 5xx y SQLSTATE no atraviesen el envelope visible.

## Datos que no se registran

- JWT o refresh token;
- contraseña;
- coordenadas;
- identificador completo del pedido;
- cuerpos HTTP;
- anon key completa;
- SQLSTATE crudo.

## Errores visibles y accionables

- sesión vencida;
- permiso preciso ausente;
- ubicación del sistema apagada;
- sin red/reintento;
- pedido desactualizado o revisión conflictiva;
- acceso denegado;
- servicio detenido.

Los textos anteriores se verifican en widget tests con UTF-8 correcto. El bridge acepta sólo el estado contractual `noSignal`; el alias histórico `no_signal` se migra únicamente al leer metadata nativa antigua y nunca se acepta como evento.

## Restricciones preservadas

- Sin `service_role` en cliente.
- Sin AccessibilityService.
- Sin WebView final.
- Sin GPS falso.
- Sin cambios de backend/Supabase, contratos Gate 1/2, producción o firma release.

## Riesgos residuales

- Debe verificarse sanitización de logcat en un recorrido físico real, incluido comportamiento del SDK/proveedor bajo fallas.
- La seguridad ante dispositivo rooteado o instrumentación fuera del modelo Android no forma parte de esta etapa.
- No hay garantía de ejecución después de **Forzar detención**.
- Las pruebas live de staging que requieren credenciales se mantuvieron omitidas; deben correrse sólo con secretos inyectados de forma segura.
