# Instaladores del equipo: app de repartidor y agente de impresión

Ninguno de los dos se publica en un lugar público. Viven en el bucket **privado** `team-apps` de CONTROLLED_PRODUCTION, en la carpeta del comercio. Sólo los puede leer el dueño o el encargado de ese comercio, por la RLS de storage (migración `20260928150000`).

- Desde el Panel se crea un **link firmado que vence en 7 días** y se manda a quien corresponde.
- Walter no necesita acceso a GitHub ni a OneDrive.

## RIDER_INSTALL_PATH

**Panel › Equipo › App de repartidor › «Crear link de descarga (7 días)» → Copiar o Mandar por WhatsApp.**

| Dato | Valor |
| --- | --- |
| Paquete | `com.lataba.rider.pilot` |
| Versión | `0.1.3-canonical-pilot` (versionCode 4), la certificada contra CP |
| SHA-256 del APK | `2fcc64f9c8cac31fcc65449b25d604e9dc04dae87e5947a4f5554b9875b187d4` |
| Certificado de firma | `2dcc9b0a0cf022ebf59c500331103ee31cec9e9142d5431553131877948ec1aa` |
| Copia de resguardo | OneDrive `La-Taba/Releases/Rider/` (APK + recibo del build firmado) |
| Escaneo | 13 valores prohibidos revisados, 0 filtraciones (`docs/evidence/controlled-production/apk-scan-rider-cp-20260928.json`) |

En el teléfono del repartidor:

1. Abrir el link.
2. Permitir «instalar apps desconocidas» para el navegador o WhatsApp.
3. Instalar.
4. Entrar con el correo y la contraseña de su invitación.
5. Marcar «Disponible».

## AGENT_DISTRIBUTION

**Panel › Impresora del local › «Instalador del agente de impresión» › «Crear link de descarga (7 días)».**

- Es un instalador **interno y sin firma de código (Authenticode)**, y se dice en la pantalla. Windows pide confirmación al instalarlo («Editor desconocido»).
- **No se actualiza solo**: no hay canal de actualización automática sin firma. Una versión nueva se carga con la herramienta de abajo y se instala a mano.
- Después de instalar: Panel › Impresora del local › «Vincular una PC» → código de 10 caracteres → en el agente. El código vence a los 15 minutos.
- La impresora es opcional: no es una compuerta para abrir.

## Cómo se cargan (operador técnico)

Con la clave de servicio de CP, desde la máquina del operador. La herramienta:

- se niega si el SHA-256 no es el certificado;
- para el APK, se niega si el recibo del build no es el de CP (backend, paquete y certificado de firma);
- por defecto sólo prueba: sube recién con `--apply`.

```
npm run team-apps:status

npm run team-apps:publish -- --kind rider \
  --file "<OneDrive>/La-Taba/Releases/Rider/com.lataba.rider.pilot-0.1.3-canonical-pilot-v4-cp.apk" \
  --receipt "<OneDrive>/La-Taba/Releases/Rider/com.lataba.rider.pilot-0.1.3-canonical-pilot-v4-cp.receipt.json" \
  --expect-sha256 2fcc64f9c8cac31fcc65449b25d604e9dc04dae87e5947a4f5554b9875b187d4 --apply
```

El MSI sale del artifact del workflow `local-agent-dotnet.yml`: `taba-local-agent-<versión>-unsigned-<sha>`, que vence en 14 días en GitHub. Se baja, se verifica su SHA-256 contra `SHA256SUMS.txt` del mismo artifact y se carga:

```
npm run team-apps:publish -- --kind agent --file <taba-local-agent.msi> --version 0.1.0 --expect-sha256 <sha256> --apply
```

Cuando exista un certificado de firma de código, el MSI firmado reemplaza a este y recién ahí se puede pensar en actualizaciones automáticas.
