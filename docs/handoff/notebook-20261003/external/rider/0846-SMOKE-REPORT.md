# Smoke físico TABA2 Rider — staging

- **Fecha (UTC)**: 2026-08-05T00:45Z
- **Dispositivo**: Moto G15 `ZY32LHS6PS` · 1080×2400 · densidad 400 · Android 15
- **Rama / HEAD**: `codex/rider-map-staging` @ `95294d9`
- **Resultado**: **NO CERTIFICADO**. El smoke no pudo iniciarse.

## Estado del gate

| # | Paso | Resultado |
|---|---|---|
| 0 | Fuente verificada | ✅ rama, HEAD, árbol limpio, `80dfd0c` ancestro |
| 0 | APK trazable en el dispositivo | ✅ hash idéntico al build |
| 1 | Iniciar sesión QA | ⛔ **bloqueado — sin credencial recuperable** |
| 2–25 | Cola, pedido, privacidad, claim, retiro, recorrido, GPS, mapa, Maps, ciclo de vida, offline, llegada, código, entrega | ⛔ no ejecutados (dependen del paso 1) |

No se ejecutó ningún paso parcial ni se simuló ninguno.

## Precondiciones verificadas

```text
rama            codex/rider-map-staging
HEAD            95294d9d36a6429a21a562ea6a48b8c9ecbf8523
git status      limpio
git diff --check limpio
80dfd0c         es ancestro de HEAD

APK local       build/app/outputs/flutter-apk/app-staging-debug.apk
                170.799.074 bytes
                sha256 2bb7491e3e1c0e9ca8b9eee3ee00b82f5bdcc0e5e2bfc1b96ef5454a6bf26155
APK instalado   /data/app/.../com.lataba.rider.staging/base.apk
                sha256 2bb7491e3e1c0e9ca8b9eee3ee00b82f5bdcc0e5e2bfc1b96ef5454a6bf26155
                → coincide; el dispositivo corre exactamente el build bajo prueba
```

Instalación previa hecha con `adb install -r`. No se usó `uninstall` ni `pm clear`
en ningún momento.

## Por qué está bloqueado el paso 1

Se buscó la credencial Rider QA de forma local y privada, sin exponer valores:

| Fuente | Resultado |
|---|---|
| Variables de entorno (`TABA*`, `QA*`, `RIDER*`, `SUPABASE*`) | ninguna definida |
| `.env` reales en los worktrees de `C:\1212` y `D:\1212` | ninguno; solo `.env.example` (plantillas sin valores) |
| Windows Credential Manager | sin entrada de rider; solo GitHub, Docker, Microsoft y `Supabase CLI:supabase` |
| Gestores de secretos locales (`bw`, `op`, `pass`, `secret-tool`) | no instalados |
| Documentación QA excluida de Git | `docs/manual-qa-checklist.md` no contiene credenciales |
| Runtime QA de dispositivo `C:\1212\taba-device-test-runtime` | ver abajo |

El harness QA está **diseñado para no persistir el secreto**:

```text
start-taba-device-test.ps1
  L277  Read-Host 'Secret key activa de la-taba-demo' -AsSecureString
  L286  Read-Host 'Publishable key activa de la-taba-demo' -AsSecureString
  L294  $env:TABA_QA_SUPABASE_SECRET = <valor en memoria>
  L299  Remove-Item Env:\TABA_QA_SUPABASE_SECRET
  L439  Remove-Item Env:\TABA_QA_SUPABASE_SECRET
```

El operador humano introduce la clave interactivamente y el script la borra del
entorno al terminar. No queda archivo DPAPI, `.enc`, `.cred` ni equivalente.

`session.json` de la corrida del 2026-07-28 registra `riderQa: "OK"` — es un
**estado de resultado**, no una credencial. Indica que el actor Rider QA fue
creado en staging en su momento; lo que no está disponible es su secreto.

No se inventó ninguna contraseña, no se pidió pegarla en el chat y no se intentó
derivar una clave de servicio a partir del token del CLI de Supabase.

## Consecuencia sobre el pedido QA

La creación del pedido QA sintético también quedó bloqueada: requiere el mismo
acceso al backend de staging. No se creó ni se modificó ningún pedido.
**`LT-0030` no fue leído ni tocado.** No se ejecutó Mercado Pago ni ARCA, no se
movió stock y no se modificó ningún pedido humano.

## Cleanup

No hubo nada que limpiar porque no se creó estado:

| Ítem | Estado |
|---|---|
| Pedido QA | no creado |
| Claims QA activos | 0 |
| Ubicaciones QA pendientes | 0 |
| Locks | 0 |
| Trabajo offline pendiente | 0 |
| Stock QA | sin tocar |
| Pedidos humanos | sin modificar |
| Sesión Rider en el dispositivo | sin sesión (la app quedó en login) |

El centinela `active_delivery.json` usado en la sesión anterior para probar el
aislamiento de la instrumentación fue removido; `no_backup/` está vacío.

## Lo que hace falta para desbloquear

Un **reset seguro** de la credencial Rider QA. Concretamente, cualquiera de:

1. Un rider QA nuevo en el proyecto de staging con una contraseña temporal
   entregada por un canal fuera de este chat, cargada como variable de entorno
   antes de la corrida.
2. Un reset de contraseña del rider QA existente, con el mismo mecanismo.
3. Ejecutar `start-taba-device-test.ps1` de forma interactiva para introducir la
   secret y la publishable key de staging y dejar el entorno preparado.

Cualquiera de las tres es una acción humana: el diseño del harness impide
automatizarla, y eso es correcto.

## Capturas

`capturas/01-app-en-login-sin-credencial.png` — la app corriendo el build
trazable, detenida en la pantalla de login. Sin datos personales, sin
coordenadas, sin credenciales.

## Gates ejecutados

Se corrieron aunque el smoke no pudo iniciarse, para dejar constancia de que el
árbol sigue sano en `95294d9`. Ninguno es destructivo.

| Gate | Resultado |
|---|---|
| `flutter analyze` | No issues found |
| `flutter test` | **109 tests** — All tests passed |
| `:app:testStagingDebugUnitTest` | BUILD SUCCESSFUL |
| `:app:testProductionDebugUnitTest` | BUILD SUCCESSFUL |
| Instrumentación aislada (13 tests) | OK — `no_backup/` quedó **vacío** después de correr |
| `git diff --check` | limpio |
| Secret scan (repo trackeado) | sin hallazgos |
| Secret scan (esta evidencia) | sin hallazgos |

La instrumentación ya no toca el almacenamiento real: se verificó que
`/data/data/com.lataba.rider.staging/no_backup/` sigue vacío tras la corrida, sin
crear ni borrar `rider_session.enc` ni `active_delivery.json`.

## Declaración

**NO** se emite `TABA2_RIDER_STAGING_PHYSICAL_SMOKE_CERTIFIED`: el flujo físico
completo no se ejecutó. Tampoco se declara nada listo para producción.
