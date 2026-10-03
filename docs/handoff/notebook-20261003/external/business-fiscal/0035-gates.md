# Gates de la certificación sintética

Ejecutados sobre `test/taba2-business-synthetic-certification`, worktree
`D:\1212\la-taba-business-synthetic-certification`.

| Gate | Resultado | Detalle |
|---|---|---|
| `npm run check` | PASS | Sintaxis, activos estáticos e higiene de release |
| `npm test` | PASS | 910 pruebas, incluidas las 11 de la jornada sintética |
| `npm run fiscal:test` | PASS | 22 pruebas del puente ARCA |
| Tests de pagos | PASS | 25 pruebas (`mercadopago-*`, consola de pagos) |
| Tests de scanner / POS / packing | PASS | 35 pruebas |
| Tests de permisos | PASS | 19 pruebas |
| Tests de apertura / cierre | PASS | 18 pruebas |
| Rust / Tauri | PASS | 17 pruebas, `CARGO_TARGET_DIR` fuera de C: |
| Chromium (Playwright) | PASS | 152/152 en 6,1 min, corrida limpia |
| `git diff --check` | PASS | Sin espacios en blanco conflictivos |
| Secret scan | PASS | Sin credenciales ni claves privadas |
| PostgreSQL local aislado | **NOT_RUN** | Ver abajo |

## PostgreSQL local aislado: NOT_RUN

`npm run test:db:isolated` (y con él `test:payments:local-db` y `test:db:local`) necesita un
contenedor Supabase local. El intento quedó registrado y falla así:

```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
check if the path is correct and if the daemon is running
```

El demonio de Docker no está corriendo en esta máquina y levantarlo no es viable acá: el disco
C: estuvo entre 0 y 86 MB libres durante toda la corrida, y las imágenes del stack local pesan
del orden de 2 GB.

**Este gate no se declara aprobado.** Las invariantes que ese gate verificaría en base están
listadas en `matriz.md` junto con la función del servidor que las garantiza; esta certificación
prueba que el panel se comporta bien frente a ellas, no que la base las aplique.

## Nota sobre la corrida de Chromium

La primera pasada completa cerró 150/152 con dos fallos (`beverage-storefront` y el fixture
fiscal del panel). Ambos volvieron a pasar al ejecutarlos aislados: la causa fue contención de
CPU por haber lanzado las capturas y la suite de Node en paralelo con el gate. La corrida que
figura arriba se hizo sin nada más compitiendo y cerró 152/152.

## Hallazgos abiertos sobre la rama fuente

No bloquean la certificación, pero quedan anotados:

1. **Corte de palabra en los encabezados de tarjeta.** En `styles/business.css`, la regla
   `.device-row header, .opening-check header` es un flex sin `flex-shrink: 0` en la etiqueta de
   estado, así que un título largo se comprime y parte al medio: se lee *"Impresora s"* y
   *"Factura ción"* en las capturas 01 y 06. Es cosmético y se arregla con un `flex-shrink: 0`
   en `.status-pill` dentro de esos encabezados.
2. **Minúscula en el botón de confirmación de impresión.** El botón se arma con
   `check.label.toLowerCase()`, de modo que "Impresora A4" queda como *"Salió el papel de
   impresora a4"*. Se ve en la captura 06.

Ninguno se corrigió acá: esta rama certifica el HEAD congelado tal como está.
