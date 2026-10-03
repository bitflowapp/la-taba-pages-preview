# Candidato productivo · taba2-production-rc2

Todo lo que se midió para decidir si TABA puede lanzarse, con sus hashes.

**Nada de acá es distribuible.** El AAB del Rider está firmado con la clave de
**depuración** de la máquina de build — su huella es idéntica byte a byte a la de
`~/.android/debug.keystore`. No existe keystore productivo. Ver `RELEASE.json`,
campo `distributable`.

---

## Qué hay

| | |
|---|---|
| `RELEASE.json` | los tres componentes, sus HEAD, identidades y hashes |
| `BUILD-MATRIX.json` | qué se construyó, con qué comando, y los **ocho rechazos que se corrieron** |
| `PRODUCTION-CONFIG-MANIFEST.json` | la matriz componente × entorno × ref × negocio × auth × pagos |
| `MIGRATION-LEDGER.json` | 103 migraciones, digest de las 100 históricas |
| `DAY1-HEALTH-CHECK.json` | la base productiva medida en vivo, sólo lectura |
| `SHA256SUMS` | de todo lo anterior |
| `RUNBOOK-GO-LIVE.md` | el orden exacto del día del lanzamiento. **Nada ejecutado.** |
| `RUNBOOK-ROLLBACK.md` | cómo volver atrás, por componente |
| `security/` | escaneos de paquete, retrato de seguridad de la base, postura de Auth |
| `web/` | `dist_release.zip` (Customer + Panel) y `dist-desktop.zip` (bundle de Tauri) |
| `rider/` | APK, AAB, SBOM CycloneDX con licencias, escaneo del paquete, sus hashes |

---

## Sobre escanear ESTE directorio

`scripts/scan-production-artifacts.mjs` está hecho para el **paquete que se
publica**, no para documentación. Correrlo acá devuelve hallazgos, y son todos
correctos y todos esperados:

- `PRODUCTION-CONFIG-MANIFEST.json` nombra el ref de staging y el businessId de
  plantilla **porque los está declarando prohibidos**;
- `AUTH-CONFIG-*.json` y `AUTH-POSTURE.md` dicen `http://localhost:3000` **porque
  es el valor medido** que hay que cambiar;
- `RUNBOOK-GO-LIVE.md` los nombra al explicar cómo cerrarlos.

Un informe que no puede nombrar el defecto que reporta no sirve. Lo que importa
del resultado: **cero P0, y ningún hallazgo dentro de los artefactos
empaquetados** — los dos zip, el APK y el AAB no aportan una sola coincidencia.

Para escanear lo que sí se publica:

```bash
node scripts/scan-production-artifacts.mjs dist_release dist-desktop \
  --business-id 00000000-0000-4000-8000-000000000001
dart run tool/package_scan.dart --artifact <apk|aab> --channel production \
  --expect-host wwcpogltfgzgkrlilbcd.supabase.co
```

---

## Reproducir

```bash
# web
npm run production:verify            # 7 pasos, no destructivo
npm run vendor:build && node scripts/create-release-folder.mjs

# rider (con la configuración productiva en el entorno)
flutter build apk     --profile --flavor production -t lib/main_production.dart
flutter build appbundle --profile --flavor production -t lib/main_production.dart
dart run tool/release_evidence.dart --output <dir> --artifact <...> \
  --channel production --scan-channel production \
  --expect-host wwcpogltfgzgkrlilbcd.supabase.co --require-clean

# este directorio
node scripts/build-release-manifest.mjs --output <dir> --rider-evidence <dir>/rider
```

Los artefactos del Rider son builds de **perfil**, no de release: el gate de
firma rechaza una release de production sin keystore, y eso no se debilitó. Un
perfil es AOT igual que una release —cero `kernel_blob.bin`, tres `libapp.so`— y
conserva algo más que una release descarta, así que lo que se escaneó es un
superconjunto de lo que llegaría al teléfono.
