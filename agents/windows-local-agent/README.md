# Taba.LocalAgent · 0.1.0

Agente local de Windows para el mostrador: **impresión y hardware**. Es la
pieza de la opción B de [`docs/PANEL-ARCHITECTURE-DECISION.md`](../../docs/PANEL-ARCHITECTURE-DECISION.md):
el Panel sigue siendo la web; este servicio resuelve lo que un navegador no
puede (imprimir sin diálogo, ESC/POS con corte y QR, elegir impresora).

**No es un segundo backend.** No sabe de pedidos, stock, precios, clientes,
pagos ni reglas fiscales: imprime lo que el backend decidió (`print_jobs`) y
cuenta honestamente qué pasó. ARCA corre del lado del servidor
(`services/arca-fiscal-bridge`); el agente sólo imprime un comprobante que ya
tiene CAE.

Operación: [`docs/LOCAL-AGENT-RUNBOOK.md`](../../docs/LOCAL-AGENT-RUNBOOK.md).

## Cómo funciona

```
backend: print_jobs (queued) ──claim (token, lease 60 s)──► agente
agente:  diario «reclamado» → backend «printing» (confirmado) → diario «entregando»
         → spooler de Windows (RAW ESC/POS o driver) → seguimiento del trabajo
         → «impreso» / «no impreso» / «desconocido» → backend
```

- **Sin la confirmación de `printing` no se imprime.** Dos agentes, un solo ganador.
- Un reinicio a mitad de la entrega deja el trabajo «desconocido»
  (`needs_review` en el backend): **nunca se reimprime solo**.
- Si el spooler deja el trabajo en error (impresora apagada, sin papel), el
  agente lo cancela en Windows para que no salga horas después.
- Reimprimir crea OTRO trabajo en el backend con `reprint_of`, quién y por qué.
- Sin backend, lo pendiente queda en el diario y se informa al volver; la
  espera crece 5 → 120 s.

## Piezas

| Pieza | Dónde |
|---|---|
| Documentos neutrales (comanda, ticket, fiscal, prueba) | `Core/Documents` (`TicketComposer`, `PrintPayloads`) |
| ESC/POS 58/80 mm, alinear, negrita, doble tamaño, QR modelo 2, corte, tablas PC850/PC858/WPC1252 | `Core/Printing/EscPos` |
| `IPrinter`: `EscPosPrinter` (RAW), `GdiTicketPrinter` («Windows», cualquier driver), `PdfPrinter` | `Core/Printing`, `Windows/` |
| Diario durable (estados por reclamo, reportes pendientes, recuperación) | `Core/Agent/PrintJournal.cs` |
| Secuencia segura por trabajo | `Core/Agent/PrintJobProcessor.cs` |
| Ciclo contra el backend (latido, reclamo según impresoras listas, espera, revocación, rotación) | `Core/Agent/BackendSyncWorker.cs` |
| Cliente de `print-agent-gateway` | `Core/Backend/GatewayBackendClient.cs` |
| Credencial del dispositivo (`tla1.<id>.<secreto>`, al backend sólo su SHA-256) | `Core/Security/DeviceCredential.cs` |
| API local 127.0.0.1 (Host, Origin exacto, token, preflight de red local) | `Core/Security/LocalApiGate.cs`, `LocalAgentHost.cs` |
| DPAPI (credencial y token), carpeta de datos cerrada | `Windows/ProtectedStores.cs` |
| Spooler: impresoras, estado, RAW, seguimiento y cancelación de trabajos | `Windows/WinSpool.cs` |
| Logs JSON saneados | `Logging/JsonFileLogger.cs` |
| CLI | `Cli/AgentCli.cs` |
| Instalador MSI (WiX v5), verificación y prueba de instalación | `installer/` |

## Construir y probar

Requisitos: SDK .NET 10 (LTS). No hace falta Visual Studio.

```powershell
cd agents/windows-local-agent
dotnet restore Taba.LocalAgent.sln
dotnet build Taba.LocalAgent.sln -c Release      # analizadores, warnings como error
dotnet test Taba.LocalAgent.sln -c Release
dotnet publish src/Taba.LocalAgent/Taba.LocalAgent.csproj -c Release -r win-x64 -o <carpeta-publish>
dotnet build installer/Taba.LocalAgent.Installer.wixproj -c Release -p:PublishDir=<carpeta-publish>\
powershell -File installer/verify-msi.ps1 -Msi installer/bin/x64/Release/TabaLocalAgent-0.1.0-win-x64.msi -Version 0.1.0
```

CI (`.github/workflows/local-agent-dotnet.yml`, Windows): build, pruebas,
publish, MSI, verificación del MSI, **instalación real** como servicio
(`installer/ci-install-test.ps1`: salud, loopback, ACL, ESC/POS por el spooler
a una impresora «Generic / Text Only» en un puerto archivo, desinstalación),
escaneo de secretos y artefactos sin firmar con `SHA256SUMS.txt`.

Correr a mano sin instalar el servicio (carpeta de datos propia):

```powershell
TabaLocalAgent.exe service --Agent:Port=17899 --Agent:DataDirectory=<carpeta>
curl.exe -H "Origin: https://la-taba-commercial-pilot.pages.dev" http://127.0.0.1:17899/v1/health
```

## API local

`127.0.0.1` solamente; todo menos `/v1/health` exige `X-Taba-Agent-Token`
(token por instalación, DPAPI). `Host` y `Origin` se validan antes que nada;
403 sin detalle.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/v1/health` | Versión, registro, backend, impresoras, cola. Sin secretos ni ids. |
| GET | `/v1/printers` | Impresoras de Windows con su estado. |
| POST | `/v1/print-test` | Hoja de prueba local (no crea trabajos en el backend). |
| POST | `/v1/reprint` | Pide al backend una reimpresión auditada (motivo obligatorio). |

La web **no** puede mandar documentos ni bytes a imprimir: todo lo que se
imprime sale de `print_jobs`.

## Lo que falta (y cómo se cierra)

- **Papel real**: certificación física con la térmica del local
  (runbook §14). Hasta entonces `PHYSICAL_PRINTER_GATE: PENDING_DEVICE`.
- **Firma**: el MSI de CI no está firmado. La entrega comercial se firma con
  Authenticode en la máquina con custodia del certificado; la actualización es
  manual (no hay auto-update sin firma verificada).
- **Panel**: la pantalla de dispositivos/estado usa RPC que ya existen
  (`get_local_print_status`, `create_local_device_pairing`,
  `request_print_job_reprint`, `resolve_print_job_review`); el frontend está
  congelado y se agrega en su propio PR.
- **PDF A4 fiscal**: `PdfPrinter` entrega el PDF tal cual a impresoras que lo
  aceptan; para el resto el comprobante sale como ticket (ESC/POS o driver).
