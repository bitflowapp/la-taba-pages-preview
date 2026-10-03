# Artefactos del Rider — TABA2-PILOT-RC2-CANDIDATE.1

Construidos desde checkout limpio del head candidato, con `build/`, `android/app/build`
y `android/.gradle` borrados antes de compilar (G4: *«Build limpio, no reutilización de
`build/`»*).

```
rider_sha   ff6d01480b36cfb02fd7e3fb6aabdbdfa6ccf4df
rama        release/taba2-rider-pilot-rc2
base        7cec5a70969d851fe37cc82aa2ee2f169f5bce7f
comando     ./gradlew :app:assembleStagingDebug :app:assembleStagingDebugAndroidTest \
              --no-daemon -Pkotlin.incremental=false
resultado   BUILD SUCCESSFUL in 7m 22s
```

## Artefactos archivados

| Archivo | Bytes | SHA-256 |
| --- | --- | --- |
| `app-staging-debug.apk` | 152 205 243 | `3cb61d528da62edd8b3c00b91186681162836cb6666f575cae6424c5bcd3fda8` |
| `app-staging-debug-androidTest.apk` | 474 399 | `84a7d660f07342f714af7ab4490c256d14cd076646b9a58dbead2da15fc00011` |

## Identidad

| Campo | Valor |
| --- | --- |
| `applicationId` | `com.lataba.rider.staging` |
| `versionName` | `1.0.0` |
| `versionCode` | `1` |
| flavor | `staging` |
| backend compilado | `ukxqbgswjlibmnjemrzd` (**la-taba-staging**) |
| `targetSdkVersion` | 36 |
| `compileSdkVersion` | 36 |
| etiqueta | TABA2 |

## Firma

| Campo | Valor |
| --- | --- |
| Signer #1 DN | `C=US, O=Android, CN=Android Debug` |
| Certificado SHA-256 | `3c57563d1d8e8d0a7fd072c990012bd293420366364f2c97548e146bc1ac7f81` |
| Esquemas | v2 ✅ · v1 ❌ · v3 ❌ · v4 ❌ |
| `apksigner verify` | **Verifies** |

**Es una APK de debug, no de release.** Coincide con lo que el plan describe (§0: *«el
Rider usado es un APK staging/debug»*) y es aceptable para un piloto de staging. La
APK firmada de release, con `versionCode` gestionado y distribución controlada, es
**P1** y bloquea producción, no el piloto.

## Toolchain

| | |
| --- | --- |
| Flutter | `C:\src\flutter` |
| JDK | Eclipse Adoptium 17.0.16.8 |
| Gradle | 9.1 |
| Android SDK build-tools | 36.0.0 |
| `GRADLE_USER_HOME` | `D:\1212\taba-rider-gradle-home` |

## Verificación en el Moto G15 (P0.7 — cerrado)

Se adquirió `moto-g15.lock` (estaba libre, `CERRADO_CON_PUNTO_PROVISIONAL`),
preservando íntegro su contenido previo.

| | |
| --- | --- |
| Dispositivo | moto g15 (`lamu_g`) serial `ZY32LHS6PS`, Android 15 |
| Instalación | `adb install -r`, **sin `pm clear`** → `Success` |
| Ruta en el dispositivo | `/data/app/~~bX2LA-uzQRds8bPqq_26mw==/com.lataba.rider.staging-nzu1_CBDghas2Kye-inRow==/base.apk` |
| sha256 local | `3cb61d528da62edd8b3c00b91186681162836cb6666f575cae6424c5bcd3fda8` |
| sha256 extraído del Moto | `3cb61d528da62edd8b3c00b91186681162836cb6666f575cae6424c5bcd3fda8` |
| **Resultado** | ✅ **coinciden** |

Antes de instalar se comprobó que `no_backup` tenía `rider_session.enc` pero **no**
`active_delivery.json`: no había reparto activo que pisar.

### Discrepancia encontrada en el estado previo

El APK que estaba instalado tenía `ee0032cf81d5e244866be732729ac0fa5140f8adb58b1eab9a6e5857821fd26f`,
mientras que `moto-g15.lock` declaraba `81633242680905a0e086197fe9d2f6fc4138520bb96c6e1cb851116f96fc6cfb`.
Como esta misma sesión demostró que Android conserva el `base.apk` byte a byte, la
diferencia no es del sistema de archivos: **el APK que había en el teléfono no era el
que su lock declaraba**.

### Tests de instrumentación

`13 corridos, 1 falla`, excluyendo el paquete `com.lataba.rider.qa` (necesita
credenciales y tocaría staging).

- ✅ `EncryptedSessionStoreInstrumentedTest`, `StorageIsolationInstrumentedTest`
- ❌ `FusedLocationSourceInstrumentedTest.callbacksFromAnOldProfileOrStoppedSourceAreIgnored`
  — determinista (falla 2/2 aislada) y **preexistente**: esa clase no la toca
  `ff6d014`, y su último cambio `cfce79f` ya está en la base `7cec5a7`.

## Lo que NO se hizo

- **No se ejecutó G5.** El teléfono no se movió y no se afirma ningún desplazamiento.
- No se corrieron los tests del paquete `qa`.
- No se probó clean install ni upgrade desde la versión previa.
- No se borró ningún dato del teléfono: sin `pm clear`, sin factory reset, sin
  desinstalar apps. `com.lataba.rider.review` y `com.logistics.rider.pedidosya`
  quedaron intactas.
