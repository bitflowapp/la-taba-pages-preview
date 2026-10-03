# ADR-003 — Tokens y requests autenticados permanecen en Kotlin

Estado: Propuesto  
Fecha: 2026-08-02

## Contexto

SessionManager y EncryptedSessionStore ya mantienen tokens fuera de Dart y hacen refresh single-flight. El futuro uploader necesita ejecutar con pantalla cerrada. Pasar tokens por MethodChannel, guardarlos en Dart o copiar credenciales en la cola ampliaría la superficie y rompería la semántica de logout.

## Decisión

SessionManager es la única autoridad de access/refresh token. El servicio consume SessionProvider/AuthenticatedRpcClient por inyección nativa. Cada 401 hace un refresh single-flight y como máximo una repetición si la sesión observada sigue vigente. Sign-out detiene captura/uploader antes de limpiar tokens y elimina/invalida la cola vinculada al rider scope. El bridge solo recibe snapshots, estados y reason codes sanitizados.

La publishable key puede estar en BuildConfig; no es secreto de autorización. No usar service_role, claves privadas ni credenciales del rider en Flutter/logs.

## Alternativas consideradas

1. Flutter HTTP para el uploader: descartada porque background/isolate/credenciales serían menos controlables.
2. Token duplicado en SharedPreferences/Dart: descartada por copias y lifecycle ambiguo.
3. Renovar sesión en cada callback: descartada por tormenta de refresh y carreras.
4. Mantener cola después de logout para enviar luego: descartada salvo política explícita de identidad/retención.

## Consecuencias

Positivas: menor superficie de secreto, comportamiento uniforme con Auth actual, mejor fail-closed.  
Negativas: más interfaces nativas y tests de concurrencia; la UI depende de eventos para saber que debe reautenticar.

## Requisitos de aceptación

- Bridge tests prueban ausencia de token y body.
- Concurrent 401 produce una sola actualización.
- Cambio de rider/role invalida requests/queue anteriores.
- Sign-out no deja requests en vuelo con credencial vieja.
- Keystore invalidado/corrupto detiene publicación sin fallback inseguro.
