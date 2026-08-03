# Activación ARCA: readiness y runbook

## Gate actual

La aplicación arranca con `ARCA_ENVIRONMENT=disabled`. Para homologación, el único consentimiento aceptado por el worker es:

```text
I_AUTHORIZE_ARCA_HOMOLOGATION
```

Sin esa frase el worker no carga credenciales para llamadas remotas ni ejecuta WSAA/WSFEv1. Producción queda bloqueada por diseño.

## Antes de autorizar llamadas

1. Obtener el certificado de homologación por WSASS mediante intervención humana.
2. Montar certificado, clave privada y service role en rutas absolutas fuera del repositorio.
3. Ejecutar `npm run arca:credentials -- verify-pair ...` y `verify-chain ...`.
4. Confirmar CUIT, punto de venta, relación WSAA/WSFEv1 y reloj.
5. Obtener aprobación contable documentada; hasta entonces el estado es `ACCOUNTANT_POLICY_APPROVAL_PENDING`.

## Health y panel

El bridge publica sólo `/health` y `/ready` en `127.0.0.1`. Devuelve indicadores sanitizados, no secretos. El panel Windows muestra ambiente, CUIT, certificado/clave como indicadores, vigencia, relaciones, conexión, última prueba, error sanitizado y outbox pendiente. El panel no recibe ni persiste PEM, claves, tokens, contraseñas ni service role.

## Homologación autorizada

Después del consentimiento exacto y con credenciales válidas: `FEDummy`, WSAA, sincronización de parámetros, último autorizado, factura sintética, consulta, CAE, QR, PDF, Storage, preview, descarga, spool, nota asociada si la política lo permite, reconciliación y cleanup. Una ambigüedad consulta antes de reintentar; una falla ARCA no revierte un pago ni inventa un CAE.
