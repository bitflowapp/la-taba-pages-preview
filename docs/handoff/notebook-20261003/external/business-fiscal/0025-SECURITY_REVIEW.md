# Revisión de seguridad

- Producción fiscal queda deshabilitada por diseño.
- Homologación no ejecuta llamadas sin `I_AUTHORIZE_ARCA_HOMOLOGATION`.
- Endpoints ARCA están compilados en allowlist y requieren HTTPS.
- Health/readiness sólo escucha en `127.0.0.1` y limita solicitudes.
- Rutas de certificado, clave y service role deben ser absolutas y externas al repositorio.
- `.gitignore` bloquea `.key`, `.p12`, `.pfx`, `.pem`, carpetas de secretos y bundles.
- Logs y respuestas de health excluyen tokens, firmas, contraseñas, claves y service role.
- El panel muestra sólo indicadores; no persiste secretos ni certificados completos.
- No se hicieron mutaciones remotas, emisión fiscal ni pagos reales.

Pendiente antes de homologar: validar credenciales suministradas, relación WSAA/WSFEv1, política contable y reloj.
