# ARCA · runbook de homologación (WSAA + WSFEv1)

Estado al 2026-09-26: **ARCA_CODE_READY_FOR_HOMOLOGATION: YES ·
ARCA_HOMOLOGATION: PENDING_CREDENTIALS · ARCA_PRODUCTION: NO**.

La facturación corre **del lado del servidor** (`services/arca-fiscal-bridge`),
nunca en la PC del local: un pedido se factura aunque la PC esté apagada, y la
clave privada vive en un solo lugar. El agente local sólo imprime un
comprobante que ya tiene CAE.

Diseño y fuentes: [`docs/arca/ARCA-FISCAL-DESIGN-2026-09.md`](arca/ARCA-FISCAL-DESIGN-2026-09.md),
[`docs/arca/README.md`](arca/README.md). Fuente primaria: documentación y WSDL
oficiales de ARCA (manual WSFEv1 4.7 del 2026-09-01, especificación WSAA 1.2.2).
**Homologación no tiene validez fiscal.**

```
venta / pedido ─► fiscal_documents (queued) ─► fiscal_outbox (lease)
   worker: WSAA (TA 12 h) ─► FECompUltimoAutorizado ─► reserva de número ─► FECAESolicitar
        ─► CAE ─► fiscal_documents (authorized) ─► PDF + QR ─► print_jobs (fiscal_receipt) ─► agente
```

---

## 1 · Prerrequisitos (acciones humanas)

| # | Qué | Quién | Dónde |
|---|---|---|---|
| 1 | CUIT emisora de pruebas (la del comercio o una de testing) | Responsable fiscal | — |
| 2 | Certificado de **homologación** | Titular de la clave fiscal | WSASS (Autogestión Certificados Homologación) |
| 3 | Autorizar el certificado al servicio `wsfe` | Titular | WSASS → «Crear autorización a servicio» |
| 4 | Punto de venta para web services (homologación) | Titular | ABM de puntos de venta |
| 5 | Política contable del comercio aprobada (tipo de comprobante, condición del receptor, **CondicionIVAReceptorId**, concepto, documento del receptor) | Contador | `fiscal_accounting_policies` |
| 6 | Autorización registrada para usar homologación (`authorize_arca_homologation`) | Dueño/admin | Panel / RPC |

En producción, además: el comercio **delega** `wsfe` a la CUIT del sistema en el
Administrador de Relaciones y se emite el certificado de producción en
«Administración de Certificados Digitales». Nunca comparten certificado.

## 2 · Montar los secretos (nunca en el repo)

Archivos absolutos fuera del repositorio, en el volumen privado del worker:

```
ARCA_ENVIRONMENT=homologation
ARCA_CUIT=<11 dígitos>
ARCA_CERTIFICATE_PATH=/run/secrets/arca-homo-cert.pem
ARCA_PRIVATE_KEY_PATH=/run/secrets/arca-homo-key.pem
ARCA_TA_CACHE_PATH=/var/lib/taba-fiscal/ta.json        # 0600, sobrevive reinicios
ARCA_HOMOLOGATION_CONSENT=I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_PATH=/run/secrets/supabase-service-role
```

`ARCA_PRODUCTION_ENABLE` **no** se define en homologación.

## 3 · Verificar configuración y certificado (sin red)

```
npm --prefix services/arca-fiscal-bridge ci
npm --prefix services/arca-fiscal-bridge run arca -- verify-config
```

Esperado: `certificateMatchesCuitAndKey: true`, huella SHA-256, vencimiento y
días restantes. Nunca imprime el PEM. Falla si la clave no corresponde al
certificado, si el CUIT no está en el certificado o si venció.

## 4 · Conectividad y autenticación

```
npm --prefix services/arca-fiscal-bridge run arca -- dummy        # FEDummy: AppServer/DbServer/AuthServer = OK
npm --prefix services/arca-fiscal-bridge run arca -- auth-test    # WSAA LoginCms: vencimiento del TA y largos de token/sign
```

`auth-test` nunca muestra token ni sign. Si WSAA responde
`coe.alreadyAuthenticated`, ya hay un TA vigente que este proceso no tiene:
con `ARCA_TA_CACHE_PATH` se reutiliza; sin él, esperar a que venza (≤ 12 h).

## 5 · Parámetros oficiales

```
npm --prefix services/arca-fiscal-bridge run arca -- params
```

Cuenta las entradas de las 7 tablas: tipos de comprobante, documentos,
alícuotas, monedas, conceptos, puntos de venta y **condiciones frente al IVA
del receptor** (`FEParamGetCondicionIvaReceptor`). El worker, al arrancar y cada
6 h, las guarda como snapshots versionados; una política cuyo
`recipient_vat_condition_id` no esté en la tabla vigente **no resuelve**.

Verificar además que el punto de venta del paso 1.4 aparece habilitado.

## 6 · Emitir un comprobante de prueba

```
npm --prefix services/arca-fiscal-bridge run arca -- last  --pos <pv> --type 11
npm --prefix services/arca-fiscal-bridge run arca -- issue-test --pos <pv> --type 11 --amount 100 \
    --vat-condition 5 --confirm I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION
npm --prefix services/arca-fiscal-bridge run arca -- query --pos <pv> --type 11 --number <n>
```

- `issue-test` pide `FECompUltimoAutorizado` y emite el siguiente número con
  concepto 1, receptor «Consumidor Final» (`DocTipo 99`, `DocNro 0`) salvo que
  se indique otro, y la `CondicionIVAReceptorId` indicada (ej.: 5 = Consumidor
  Final, validar contra `params`).
- Tipo 11 = Factura C (monotributo). Para A/B las alícuotas salen de la
  política contable: usar el flujo completo (6.2), no la herramienta rápida.
- Exige la frase en `--confirm` **además** del consentimiento del entorno. En
  producción la herramienta se niega siempre.
- `query` debe devolver el mismo número, CAE de 14 dígitos, vencimiento y la
  condición del receptor enviada.

### 6.2 · Flujo completo (el de producción)

1. Perfil fiscal en homologación + política aprobada con `recipient_vat_condition_id`.
2. Venta de mostrador confirmada → `request_fiscal_document(...)` → `queued`.
3. Worker corriendo (`npm --prefix services/arca-fiscal-bridge start`): toma la
   outbox, reserva número, pide CAE → `authorized`.
4. Se genera el PDF (A4 con QR) y, si el comercio tiene
   `fiscal_receipt_auto`, un trabajo `fiscal_receipt` para el agente local
   (ticket con banners «COMPROBANTE DE PRUEBA · SIN VALIDEZ FISCAL»).

## 7 · Nota de crédito

```
npm --prefix services/arca-fiscal-bridge run arca -- credit-note-test --pos <pv> --type 13 \
    --associated-type 11 --associated-number <n> --amount 100 --vat-condition 5 \
    --confirm I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION
```

En el flujo completo: `request_credit_note(original, motivo, 'total'|'partial', líneas, clave)`
(owner/admin). La nota hereda la condición del receptor de la factura y no
puede superar lo facturado (asignaciones por ítem). **Un reembolso de Mercado
Pago no genera una nota de crédito sola**: son operaciones separadas.

## 8 · Fallas y reconciliación (lo que nunca hay que hacer: reemitir a ciegas)

| Situación | Qué hace el worker | Estado |
|---|---|---|
| Falta un dato (condición IVA, tipo, CUIT…) | No reserva número; `REQUIRES_FISCAL_REVIEW` | `failed` → revisión (NEEDS_RECONCILIATION de configuración) |
| ARCA rechaza (`R`, ej. 10246) | Guarda observaciones/errores; libera asignaciones de nota | `rejected` |
| Timeout / respuesta perdida | Consulta el número reservado; si no está, espera 60 s | `ambiguous` (NEEDS_RECONCILIATION transitorio) |
| Intento siguiente | `FECompConsultar` + `FECompUltimoAutorizado`: recupera el CAE si coincide; si no llegó y el número sigue libre, reenvía **el mismo número** | `authorized` |
| Lo que hay en ARCA no coincide, o el número ya se usó | `ARCA_RECONCILIATION_MISMATCH` (dead letter), **nunca otro número** | revisión humana |
| ARCA caído | Reintentos con espera creciente (hasta 30 min); a los 8, dead letter | `retry_wait` |

Para revisar un caso: `arca query` con el número reservado, comparar con
`fiscal_documents` y `fiscal_request_attempts` (hashes de pedido/respuesta,
sin secretos). La corrección se decide con el contador.

## 9 · Evidencia de homologación (qué cuenta como PASS)

`ARCA_HOMOLOGATION: PASS` sólo con, en el ambiente de homologación oficial:

1. `verify-config`, `dummy`, `auth-test`, `params` OK (con la tabla de condiciones IVA).
2. Factura emitida con CAE, consultada por número con los mismos datos.
3. Nota de crédito asociada con CAE.
4. Un reintento con respuesta perdida simulada que **recupera** el CAE sin reemitir.
5. PDF y ticket con QR que el lector oficial decodifica con los datos del comprobante.

Las pruebas con dobles (`npm --prefix services/arca-fiscal-bridge test`, pgTAP
`fiscal_receiver_vat_condition_test`) prueban contratos, **no** homologación.

## 10 · Producción (NO habilitada)

```
HUMAN_ACTION_REQUIRED:
REASON: certificado de producción de ARCA y autorización fiscal del comercio.
ACTION: (1) el contador aprueba la política contable del comercio;
        (2) el comercio delega wsfe a la CUIT del sistema y da de alta un punto de venta para web services;
        (3) el responsable emite el certificado de producción y lo carga en el secret manager;
        (4) se habilita la compuerta de producción del servidor con aprobación nominal.
```

Hasta entonces: `ARCA_PRODUCTION: NO`. El Panel no puede configurar producción
(`configure_fiscal_profile` lo rechaza) y el worker exige
`ARCA_PRODUCTION_ENABLE` además de las aprobaciones en base.
