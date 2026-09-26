# Taba.LocalAgent · spike

Agente local de Windows para el mostrador: **impresión y hardware**. Es la
pieza de la opción B de [`docs/PANEL-ARCHITECTURE-DECISION.md`](../../docs/PANEL-ARCHITECTURE-DECISION.md)
(rama `fix/taba-commercial-frontend-and-fiscal`): el Panel sigue siendo la web;
este servicio resuelve lo que un navegador no puede.

**No es un segundo backend.** No sabe de pedidos, stock, usuarios ni reglas de
negocio: recibe documentos ya decididos y los imprime. La fuente de verdad sigue
siendo el backend de La Taba.

## Qué demuestra el spike

| Pieza | Estado | Dónde |
|---|---|---|
| Cola de impresión durable e idempotente (`QUEUED → PRINTING → PRINTED / FAILED / UNKNOWN`) | Hecho, probado | `Core/Printing/PrintSpool.cs` |
| Reinicio a mitad de impresión = `UNKNOWN`, nunca se reimprime solo | Hecho, probado | `PrintSpool.RecoverAfterRestart` |
| Reimpresión auditada (nuevo trabajo con `ReprintOf` y quién la pidió) | Hecho, probado | `PrintSpool.Reprint` |
| ESC/POS: inicializar, alinear, negrita, doble tamaño, QR modelo 2 (`GS ( k`), corte | Hecho, probado | `Core/Printing/EscPos` |
| Comanda (sin precios), ticket de pedido («no válido como factura»), comprobante fiscal (sólo con CAE de 14 dígitos) | Hecho, probado | `TicketRenderer` |
| Abstracción de impresoras (`IPrinter`: `EscPosPrinter`, `PdfPrinter`; resolución por formato) | Hecho, probado | `Core/Printing/Printers.cs` |
| Spooler de Windows (RAW) y lista de impresoras (`EnumPrintersW`) | Hecho; listado verificado en una PC real | `src/Taba.LocalAgent/Windows/WinSpool.cs` |
| API local sólo en `127.0.0.1`, `Origin` exacto, `Host` contra DNS rebinding, token de instalación en tiempo constante, preflight de red local de Chrome | Hecho, probado de punta a punta | `Core/Security`, `LocalAgentHost` |
| Token protegido con DPAPI (alcance de máquina) | Hecho | `Windows/DpapiSecretProtector.cs` |
| Servicio de Windows (`UseWindowsService`) | Hecho | `LocalAgentHost` |
| Logs sin credenciales (token/sign de WSAA, PEM, cabeceras) | Hecho, probado | `Core/Security/Secrets.cs` |
| Frontera ARCA: TRA, firma CMS (`SignedCms`), caché de TA con las reglas oficiales, WSFEv1 4.7 con `CondicionIVAReceptorId`, reconciliación ante timeout | Hecho con dobles; **no homologado** | `Core/Fiscal` |

Pruebas: **88/88** (`dotnet test`, xUnit), incluida la API en memoria con
`TestServer`. Build Release con analizadores `latest-recommended` y warnings
como error: 0 advertencias.

## Lo que el spike NO demuestra (y cómo se cierra)

- **Papel real.** No hubo una térmica conectada. Falta la certificación física:
  imprimir comanda y ticket en la impresora del local, desconectarla, verificar
  `FAILED`/`UNKNOWN`, reconectar y reimprimir.
- **PDF en impresoras sin soporte PDF.** `PdfPrinter` entrega el PDF tal cual
  (sirve con impresoras que lo aceptan directo). Para el resto hay que
  renderizar páginas (PDFium o `Windows.Data.Pdf`) antes del spooler.
- **Impresión automática desde el backend.** El diseño es que el backend cree
  `print_jobs` y el agente los tome con una identidad de dispositivo (ver la
  decisión de arquitectura). Requiere una tabla y una identidad nuevas: queda
  para la fase siguiente. Hoy el agente recibe trabajos por su API local.
- **Instalador y actualización firmados.** Falta el MSI (servicio + desinstalador,
  sin certificados ni claves adentro) y la actualización con firma Authenticode
  verificada antes de reemplazar binarios.
- **ARCA real.** `ARCA_HOMOLOGATION: BLOCKED` hasta tener certificado de WSASS,
  CUIT y punto de venta de prueba. Producción: `ARCA_PRODUCTION_DISABLED_BY_DESIGN`
  (el gateway lo rechaza aunque se le pase el ambiente). En la arquitectura
  recomendada ARCA corre del lado del servidor; esta frontera existe para el
  comercio que exija custodia local del certificado.
- **TA tras un reinicio.** La caché del Ticket de Acceso vive en memoria. WSAA
  responde `coe.alreadyAuthenticated` si se pide otro mientras el anterior vale
  (12 h): si la custodia local se habilita, el TA se persiste protegido con DPAPI.

## Uso

Requisitos: SDK .NET 10 (LTS). No hace falta Visual Studio.

```powershell
cd agents/windows-local-agent
dotnet restore
dotnet build -c Release
dotnet test -c Release
```

Correr local (sin instalar el servicio):

```powershell
dotnet run --project src/Taba.LocalAgent -c Release -- --Agent:DataDirectory=C:\temp\taba-agent --Agent:Port=17872
curl.exe -H "Origin: https://la-taba-commercial-pilot.pages.dev" http://127.0.0.1:17872/v1/health
```

API (`127.0.0.1` solamente; todo menos `/v1/health` exige `X-Taba-Agent-Token`):

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/v1/health` | Agente, impresoras, cola, estado fiscal. Sin secretos. |
| GET | `/v1/printers` | Impresoras de Windows (nombre, predeterminada). |
| POST | `/v1/print-jobs` | Encola un documento **estructurado** (el agente renderiza; la web nunca manda bytes crudos). Idempotente por `idempotencyKey`. |
| GET | `/v1/print-jobs/{id}` | Estado del trabajo, sin su contenido. |
| POST | `/v1/print-jobs/{id}/reprint` | Reimpresión auditada. |

Configuración en `appsettings.json` (`Agent:Port`, `Agent:AllowedOrigins`,
`Agent:DataDirectory`). Los orígenes se comparan exactos; uno `http://` sólo se
acepta para `localhost`. El token se genera en la instalación, se guarda con
DPAPI y se entrega al Panel una vez, al emparejar; ningún endpoint lo devuelve.

## Seguridad

- Escucha en `127.0.0.1`: no abre puerto a la red del local.
- Sin permisos de administrador para operar (sólo para instalar el servicio).
- `Host` y `Origin` validados antes que cualquier otra cosa; respuesta 403 sin
  detalle.
- XML de ARCA leído con DTD prohibida y sin resolver entidades.
- La clave privada del certificado nunca se exporta; en el agente viviría en el
  almacén de certificados de Windows como no exportable.
