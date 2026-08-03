# Puente fiscal privado ARCA

## Fuentes y alcance investigado

Consulta realizada el 2 de agosto de 2026. Autoridad utilizada exclusivamente: documentación oficial de ARCA.

- [Arquitectura general WSAA/WSN](https://arca.gob.ar/ws/documentacion/arquitectura-general.asp): SOAP/HTTPS, certificado X.509, CMS/PKCS#7 y Ticket de Acceso.
- [Documentación WSAA](https://arca.gob.ar/ws/documentacion/wsaa.asp) y [Manual del Desarrollador, Publicación 2](https://arca.gob.ar/ws/WSAA/WSAAmanualDev.pdf).
- [WSASS de homologación](https://www.arca.gob.ar/ws/WSASS/html/introduccion.html): certificados de testing y autorización al servicio.
- [Homologación externa](https://www.arca.gob.ar/ws/documentacion/homologacion-externa.asp): WSFEv1 RG 4291, manual del desarrollador versión 4.5.
- [Manual WSFEv1 4.5](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf): métodos, contratos, tablas, endpoints y WSDL.
- [QR, especificación versión 1](https://arca.gob.ar/fe/qr/documentos/QRespecificaciones.pdf) y [alcance](https://arca.gob.ar/fe/qr/conceptos-generales.asp).

El WSDL oficial es dinámico y no declara un número de versión independiente: se registra como “WSDL consultado junto al manual WSFEv1 4.5”. Homologación usa `https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL`; producción usa `https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL`. Los dominios históricos `afip.gov.ar` se conservan porque siguen publicados por ARCA.

El alcance técnico inicial es WSFEv1 para mercado interno compatible. WSMTXCA, exportación, CAEA, regímenes especiales y controladores fiscales quedan bloqueados y requieren otra integración. No se decide condición fiscal, tipo de comprobante, alícuota ni identificación del receptor por inferencia.

## Ambientes y gates

`ARCA_ENVIRONMENT` admite `disabled`, `homologation` y `production`; el valor predeterminado es `disabled`. Homologación exige la frase exacta documentada en `.env.example`. Producción tiene otra frase y además depende del perfil de servidor, certificado de producción, CUIT, punto de venta, relación autorizada, secret manager, aprobación operativa y `accountant_review_status = approved`.

No se puede cambiar ambiente, endpoint, certificado, CUIT, tipo, número o CAE desde query string, localStorage ni UI pública. La allowlist contiene sólo los endpoints oficiales compilados. Homologación no tiene validez fiscal.

## Secrets e instalación

```powershell
npm --prefix services/arca-fiscal-bridge ci
npm --prefix services/arca-fiscal-bridge run build
npm --prefix services/arca-fiscal-bridge run credentials:check
npm --prefix services/arca-fiscal-bridge test
npm --prefix services/arca-fiscal-bridge start
```

Certificado, clave privada y service role se montan como archivos absolutos fuera del repositorio. `.env` y extensiones de certificado/clave están ignoradas. `credentials:check` informa solamente coincidencia, fingerprint SHA-256, vencimiento, días restantes y alerta menor a 30 días; nunca imprime PEM. El worker valida CUIT en el certificado y que clave/certificado correspondan.

`SUPABASE_SERVICE_ROLE_PATH` apunta a un archivo secreto. La cuenta sólo recibe execute sobre claim, reserva, snapshot de parámetros y complete. No exponer el proceso ni el health check fuera de loopback; `/health` y `/ready` no devuelven secretos y tienen límite interno.

## WSAA y WSFEv1

WSAA genera TRA con reloj acotado, firma CMS/PKCS#7, bloquea XML con DTD/entidades, cachea por ambiente/CUIT/servicio y comparte renovaciones concurrentes. Refresca con cinco minutos de margen y no registra token/sign.

WSFEv1 implementa `FEDummy`, `FECompUltimoAutorizado`, `FECAESolicitar` y `FECompConsultar`. Sincroniza cada seis horas tipos de comprobante, documentos de receptor, IVA, monedas, conceptos y puntos de venta. Cada snapshot conserva ambiente, tipo, hash de versión y fecha; no se hardcodean sus valores.

Antes de solicitar CAE se reclama la outbox con `SKIP LOCKED`, lease y owner; se consulta último autorizado; una RPC con advisory lock reserva localmente el siguiente número y aplica la unicidad ambiente/CUIT/punto/tipo/número. Timeout o respuesta truncada se clasifica ambigua y se consulta antes de cualquier reenvío. Cada intento conserva hashes y mensajes sanitizados. Tras ocho fallos transitorios pasa a dead letter; configuración incompleta falla cerrado sin reintentos ciegos.

## QR, PDF y notas de crédito

El QR usa JSON determinista versión 1, Base64 y URL oficial. No se genera sin CAE/CAEA válido de 14 dígitos. El PDF autorizado y el comprobante interno pendiente son visualmente distintos; el pendiente no lleva CAE ni QR.

Una factura autorizada es inmutable y no se elimina. La solicitud de nota de crédito total exige owner/admin, motivo, idempotencia y vínculo con el original. El tipo fiscal concreto permanece sujeto a parámetros oficiales y aprobación contable; si no está configurado, el worker marca “Requiere datos fiscales o revisión” y no emite.

## Homologación autorizada

1. Obtener certificado mediante WSASS con clave fiscal personal; este paso no se automatiza.
2. Autorizar el certificado al servicio `wsfe` y confirmar CUIT representado.
3. Montar secretos fuera del repositorio, configurar CUIT/punto de venta de testing y ejecutar `credentials:check`.
4. Registrar aprobación del responsable para usar homologación y recién entonces fijar la frase de consentimiento.
5. Ejecutar `FEDummy`, sincronizar parámetros y validar el punto de venta.
6. Cargar un caso sintético acordado con contador; consultar último autorizado, emitir, consultar por número, verificar CAE/observaciones, QR y PDF.
7. Si el caso lo permite y está aprobado, solicitar una nota de crédito asociada. Conservar la evidencia fiscal de homologación.

Sin certificado/configuración/consentimiento, el resultado correcto es `ARCA_HOMOLOGATION_BLOCKED`; nunca se declara PASS.

## Notas de crédito y evidencia documental

La resolución versionada de tipo, crédito total/parcial, reconciliación, PDF/QR propio y homologación están especificados en [Notas de crédito, política contable y homologación](credit-notes-and-homologation.md).

## Checklist contable previo a producción

- Condición fiscal y razón social del emisor.
- Tipos de comprobante por receptor/operación.
- Punto de venta exclusivo y relación autorizada.
- Datos exigibles del receptor y reglas con vigencia/fuente.
- Concepto, bases, alícuotas, exentos, no gravados, tributos y percepciones.
- Momento de emisión para mostrador y pedidos online.
- Políticas de nota de crédito, motivos, importes y permisos.
- Regímenes especiales, CAEA, exportación o WSMTXCA que deban bloquearse.
- Leyendas, conservación documental, duplicados, PDF y reimpresión.
- Certificado de producción, rotación, monitoreo y respuesta a incidentes.

La aprobación se registra en el servidor; no es una preferencia de operador. Hasta completarla, `ARCA_PRODUCTION_DISABLED_BY_DESIGN` es obligatorio.

## Despliegue futuro, recuperación y rollback

Ejecutar el worker en una red privada, con Node.js 22+, identidad de servicio dedicada, secret manager, reloj sincronizado, TLS saliente, logs centralizados y una sola release verificable. Health, métricas y shutdown ordenado están incluidos. No desplegar junto al panel ni incluir secretos en imagen o variables visibles al usuario.

Si el proceso cae, el lease vence y otro worker reclama. Si la caída ocurrió tras enviar, el documento queda ambiguo y se consulta. No cambiar de número ni reenviar a ciegas. Para rollback, detener nuevos claims, esperar leases, conservar intentos/documentos, desplegar la versión anterior compatible y reconciliar ambiguos antes de reanudar. Nunca borrar una autorización ni una evidencia para revertir software.
