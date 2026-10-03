# Aplicación Mercado Pago

Fecha de consulta: 2026-08-03 (America/Buenos_Aires)

Estado: **AUTENTICACIÓN HUMANA REQUERIDA**.

## Evidencia

- Panel oficial consultado: `https://www.mercadopago.com.ar/developers/panel/app`.
- El acceso redirigió al login oficial para DNI, e-mail o teléfono y mostró protección reCAPTCHA.
- No había una sesión autorizada disponible para enumerar aplicaciones.
- No se creó, editó ni duplicó ninguna aplicación.
- No se consultaron ni activaron credenciales productivas.

## Pendiente tras autenticación

Verificar una única aplicación `TABA2` bajo la cuenta vendedora real del negocio, país Argentina y titular autorizado. Si no existe, crearla sólo bajo esa cuenta con Pagos online → desarrollo propio → Checkouts → Checkout Pro. Registrar únicamente application ID abreviado, propietario verificado, cuenta receptora y disponibilidad del ambiente test.

## Auditoría de este turno

No se abrió el panel ni se intentó login en este turno. La autenticación humana y la verificación de la cuenta vendedora siguen pendientes. No se modificó ninguna aplicación ni se leyó ningún secreto.

## Autoridad oficial

| URL | Título | Consulta | Versión/fecha visible | Decisión derivada |
|---|---|---|---|---|
| `https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/create-application` | Crear aplicación | 2026-08-03 | Copyright 2026; sin versión de página visible | Una aplicación por solución; comprobar `Tus integraciones` antes de crear; Pagos online + desarrollo propio + Checkout Pro; la identidad/reautenticación es humana. |
| `https://www.mercadopago.com.ar/developers/es/docs/your-integrations/application-details` | Detalles de aplicación | 2026-08-03 | Copyright 2026; sin versión visible | Verificar número, solución e identidad de la aplicación sin revelar credenciales. |
| `https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/credentials` | Credenciales | 2026-08-03 | Copyright 2026; sin versión visible | Access Token sólo backend; ambiente test separado; no activar producción. |

No se guardaron cookies, credenciales ni capturas del login en este artefacto.
