# TABA Real Controlled Pilot Runbook (v1)

Estado inicial: preparado para ejecución pendiente de aprobación de migraciones y configuración de datos QA.

## Entorno objetivo
- Proyecto Supabase: la-taba-staging
- Project ref: ukxqbgswjlibmnjemrzd
- Región: us-east-1
- Origen frontend previsto: HTTPS staging (pendiente de definir)
- Estado actual (2026-07-30):
  - Proyecto staging remoto verificado y listado (`la-taba-staging`).
  - Project ref no coincide con proyecto demo (`yakhtrkukqlgzvxuvhzs`) ni producción.
  - Migraciones locales: 17.
  - Migraciones pendientes en remote staging (no aplicado aún): 17 (tabla `supabase_migrations` ausente).
  - `migration-ledger-local.json` generado en `C:\1212\artifacts\taba-staging-pilot`.
  - `migration-ledger-remote-before.json` generado con estado remoto previo.
  - `staging-migrations-pending.txt/json` generado con lista exacta de pending.
  - URL HTTPS staging verificable: `https://ukxqbgswjlibmnjemrzd.supabase.co`.
  - Publishable key de staging obtenida (uso restringido): `sb_publishable_Jkz0...`.
  - `staging-project-status.json` creado como snapshot de estado operacional y migraciones.

## Evidencias de ejecucion ya realizadas
- `npm ci --no-audit --no-fund` ✅
- `npm run vendor:build` ✅
- `npm run check` ✅
- `npm test` ✅
- `npm run migrations:validate` ✅ (`17` migraciones revisadas, sin errores bloqueantes)
- `npm run catalog:images:verify` ✅ (22 productos / 44 WebP)
- `npm audit --audit-level=high` ✅ (0 vulnerabilidades)
- `git diff --check` ✅ (sin problemas de whitespace)

Pendientes criticos antes de avanzar al piloto real:
- Confirmar aprobación explicita para aplicar migraciones remotas (ver lista en artifacts).
- Confirmar autorización para publicar `dist_release` en HTTPS staging.
- Inyectar `runtime-config.js` de staging con solo:
  - `supabaseUrl` HTTPS de `la-taba-staging`.
  - `publishableKey` publica.
  - `deploymentEnvironment: 'staging'`.
  - `businessId` de staging.
- Desplegar frontend por workflow autorizado (HTTPS staging).
- Configurar Auth, cuentas QA y catalogo minimo operativo.

## Runbook de prueba real (cliente / negocio / rider)

### 1) Telefono cliente
- Fecha/Hora: 
- Dispositivo/so: 
- URL de acceso HTTPS: 
- Modo app: `demo=0` (sin fallback preview)
- Perfil/checkout: 
- Direccion usada: 
- Resultado esperable: creacion de pedido en estado recibido/submit, seguimiento visible.

### 2) Panel negocio
- Cuenta QA de negocio: 
- Ruta de acceso: 
- Resultado esperable por pedido: recibido ? aceptado ? preparando ? listo
- Asignacion de rider: esperable solo a riders activos del mismo comercio.

### 3) Telefono rider
- Cuenta QA rider: 
- Permisos de ubicacion otorgados: si/no
- Resultado esperable: toma pedido ? salir ? llegar ? codigo de entrega solo en estado permitido.

### 4) Evidencias minimas obligatorias
- Prueba de auth (cliente y equipo)
- Catalogo: 22 productos y 44 WebP
- Estados de pedido: confirmed / preparing / ready / on_the_way / arriving / delivered
- Tracking token: revocable y no cruzado entre pedidos
- GPS: publicado por rider asignado con `source='gps'` y sujeto a politicas
- Realtime: transicion de estados visible en segundo dispositivo
- Expiracion/revocacion del tracking
- Codigo de entrega visible solo cuando corresponde
- En caso de uso de GPS y Realtime, validar en dispositivos reales:
  - Sin fallback a pedido alterno (Pedido A != Pedido B).
  - `source='gps'` solo en rider asignado y solo dentro de estados operativos.
  - Tracking token sin GPS/codigo en estados terminales.

## Matriz de control por actor
| Actor | Control | Resultado |
| --- | --- | --- |
| Cliente | Login anónimo + pedido propio | Pendiente |
| Cliente | Tracking con token correcto | Pendiente |
| Negocio | Operacion por roles | Pendiente |
| Rider | Asignacion / GPS / entrega | Pendiente |
| Seguridad | Accesos cruzados (A ? B) | Pendiente |

## Checklist de ejecución fisica (2 dispositivos reales)
- Cliente en red movil
- Negocio en red movil
- Rider en red movil
- GPS activo donde aplique
- Sin dependencias de red de escritorio

## Recuperacion y contingencia
- Si falla migracion o smoke: detener piloto, cancelar pedido de smoke, revocar token, limpiar sesiones y registrar evidencia.
- No usar datos personales reales.
- Mantener siempre `TABA_SMOKE_CONFIRM` para pruebas mutantes.

## Notas operativas
- Nunca usar `service_role` o credenciales privilegiadas desde navegador.
- No exponer secretos en URL, logs, commits o artefactos de frontend.
