# ADR-0003: Sesión cifrada y rotación única

- Estado: aceptado.
- Decisión: Android Keystore protege una clave AES-GCM; DataStore/archivo cifrado guarda access token, refresh token, expiración, user/business id y versión. `SessionManager` es singleton lógico con mutex de refresh. Dart recibe sólo un snapshot mínimo.
- Alternativas: SharedPreferences plano; tokens sólo en memoria; dos stores independientes.
- Motivo: el service requiere restauración; dos stores causarían refresh-token races.
- Consecuencia: logout, cambio de usuario y refresh irrecuperable deben borrar el registro y detener GPS.
- No guardar credenciales en logs, notificaciones, clipboard ni errores serializados.

