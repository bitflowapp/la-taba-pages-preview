# Escaneo del paquete publicado

Herramienta: `npm run production:artifacts` (`scripts/scan-production-artifacts.mjs`).
Mira **adentro del artefacto que llega al navegador**, no el árbol de fuentes.
Datos crudos: `PACKAGE-SCAN.json`.

```
node scripts/scan-production-artifacts.mjs dist_release \
  --expect-host wwcpogltfgzgkrlilbcd.supabase.co \
  --business-id 00000000-0000-4000-8000-000000000001
```

| | |
|---|---|
| paquete | `dist_release` — lo que se publicó en `https://la-taba.pages.dev` |
| archivos | **363** |
| bytes | 9.174.835 |
| **hosts encontrados** | **1**: `wwcpogltfgzgkrlilbcd.supabase.co` |
| **negocios encontrados** | **1**: `00000000-0000-4000-8000-000000000001` |
| credenciales de servidor | **0** |
| referencias a staging | **0** |
| resultado | **artifact-scan OK** |

## Las tres coincidencias informativas

No son hallazgos y el escaneo lo dice:

| regla | archivo | por qué no importa |
|---|---|---|
| `template-business-id` | `js/core/runtime-config.js` | sólo en comentarios: documenta la forma, no configura |
| `developer-endpoint` | `js/realtime.js` | ídem |
| `developer-endpoint` | `js/vendor/supabase.js` | dependencia de terceros: su valor por omisión lo reemplaza el cliente |

## Lo que este escaneo NO deja pasar

* una clave secreta o `service_role` (por **forma** del valor, no por mencionar
  la palabra: `service_role` aparece como texto en el Panel y en el SDK);
* el ref de staging;
* el uuid de negocio de la plantilla;
* una clave privada.

## El `runtime-config` productivo

Se **deriva**, no se escribe a mano:

```
node scripts/build-production-runtime-config.mjs --key-file <clave publicable> --out dist_release/runtime-config.js
```

| | |
|---|---|
| entorno | `production` |
| host | `wwcpogltfgzgkrlilbcd.supabase.co` (derivado del ref, no pedido) |
| negocio | `00000000-0000-4000-8000-000000000001` |
| clave | publicable (`sb_publishable_…`); una secreta hace fallar el guion |
| sha256 | `ddee8a4854ca8e3dd008f92661f27516a1a70302b33a04a8b62d8833361dde3d` |
| bytes | 789 |

El repositorio guarda una **plantilla vacía** a propósito: si el config
productivo viviera versionado, cualquier preview hablaría con la base real sin
que nadie lo decidiera.
