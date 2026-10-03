# Plan de homologación ARCA

No se ejecutaron llamadas externas. El gate exigido por el sistema es la frase literal `I_AUTHORIZE_ARCA_HOMOLOGATION` y credenciales válidas montadas fuera del repositorio.

Orden previsto después de la autorización:

1. `FEDummy`.
2. Login WSAA y sincronización de parámetros WSFEv1.
3. Consulta de último autorizado.
4. Factura sintética y consulta por número.
5. Validación de CAE, QR, PDF, SHA-256, Storage, preview, descarga y spool.
6. Nota de crédito asociada sólo con política contable aprobada para el caso.
7. Reconciliación, recuperación de respuesta ambigua y cleanup permitido.

No usar datos humanos reales. No emitir en producción. No declarar certificación hasta que toda la secuencia tenga evidencia.
