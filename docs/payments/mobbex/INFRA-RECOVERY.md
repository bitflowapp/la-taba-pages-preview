# Recuperación de infraestructura — almacenamiento y Docker (2026-11-03)

Contexto: la ejecución anterior se interrumpió por falta de espacio. Este documento registra lo medido, lo que se hizo y
lo que **no** se hizo a propósito. Todo el diagnóstico fue de solo lectura; no se movió, borró ni reinició nada de Docker.

## Medición

| Unidad | Libre al inicio | Observación |
|---|---|---|
| C: | 0,08 GB (231 GB usados) | `AppData` ≈ 56 GB; `docker_data.vhdx` = **14,72 GB** (`%LOCALAPPDATA%\Docker\wsl\disk`) |
| D: | 0,28 GB | no se tocó |
| E: | ≈ 31,8 GB | otros proyectos (p. ej. `lnm-build` 28 GB, `APEX66-*`) — **no son de esta tarea, no se tocaron** |
| F: | 0 GB | no se tocó |
| G: | ≈ 48,8 GB | no se usó |

Huella de esta tarea en E:: repositorio ≈ 0,6 GB, `node_modules` 82 MB, bases PostgreSQL descartables ≈ 0,23 GB, logs y respaldo < 10 MB.
`TEMP`, `TMP` y el caché de npm de la sesión ya apuntan a la carpeta `LUNA-Pagos-Mobbex-Rescate` de la unidad E:. Nada de esta tarea escribe en C:.

## Estado de Docker (solo lectura)

- Docker Desktop 29.6.2 responde; 11 contenedores (todos `Exited` desde el corte, ninguno borrado), 17 imágenes, 3 volúmenes, 0 en ejecución.
- **El almacén de imágenes está dañado por el corte:** `docker system df` falla con
  `blob sha256:c0c25187a6b8… expected at /var/lib/desktop-containerd/…: input/output error` y `docker image ls` falla con otro
  error de lectura de blob en el mismo almacén (hay más de un blob afectado). `docker volume ls` sí responde: los 3 volúmenes son
  `supabase_{db,edge_runtime,storage}_la-taba-pages` (la pila local de otro proyecto: no se tocó).
  No es algo que deba arreglarse con `prune` ni con reset: se pierden contenedores y volúmenes.
- `settings-store.json` no define una ubicación personalizada del disco: el VHDX sigue en su default (C:).
- Por eso las pruebas SQL de esta rama corrieron en **PostgreSQL nativo** (scoop) con datos en E:, no en Docker.

## Por qué no se movió Docker a E: (bloqueo documentado)

El procedimiento oficial y compatible de Docker Desktop (WSL 2) es **Settings → Resources → Advanced → Disk image location**,
que mueve el VHDX él mismo. Es una interfaz gráfica que no se controla desde esta sesión, y los atajos (mover el `.vhdx`
a mano, editar claves internas, `wsl --import/--export`) están excluidos: el disco está en uso, el almacén ya tiene un
blob dañado, y un error en cualquiera de esos caminos pierde imágenes/volúmenes. Tampoco se ejecutó `docker system prune`,
`docker volume prune`, Docker Reset ni Factory Reset.

### Procedimiento para quien tenga la sesión de escritorio

1. Liberar algo de C: **por decisión humana** (Docker necesita unos cientos de MB para reiniciar; hoy hay 0,08 GB). Candidatos medidos: `AppData` 56 GB.
2. Respaldar los 3 volúmenes si importan: `docker volume ls`, y para cada uno `docker run --rm -v <vol>:/v -v <carpeta-de-respaldo>:/b busybox tar czf /b/<vol>.tgz -C /v .` (cuando el motor responda), donde `<carpeta-de-respaldo>` es la carpeta `respaldo` en la raíz de la unidad E:.
3. Docker Desktop → Settings → Resources → Advanced → *Disk image location* → elegir la carpeta `Docker\wsl` en la raíz de la unidad E: (hacen falta ≈ 15 GB; E: quedaría con ≈ 17 GB) → *Apply & restart*. Esperar a que termine; no cerrar a la fuerza.
4. Verificar: `docker ps -a` (11 contenedores), `docker volume ls` (3), `docker image ls`.
5. Si el blob dañado persiste, volver a descargar **sólo esa imagen** (`docker pull <imagen>`) o dejar que el CLI de Supabase la baje al arrancar; no limpiar nada más.
6. Con Docker sano, correr el banco canónico: `TABA_LOCAL_PAYMENT_DB=1 node scripts/mobbex/run-mobbex-db-tests.mjs` (sin `--native`).

## Qué queda limpio

Se detuvo el PostgreSQL descartable propio de esta sesión (puerto 54329); no hay procesos `postgres.exe` activos.
No se mató ningún proceso ajeno. **Pendiente para una persona:** borrar la carpeta `mbx-work` de la raíz de la unidad E: (≈ 225 MB de clústeres de prueba
descartables de esta tarea: `pg3`, `pg4`, `pg5`, `pgdata`); la herramienta de seguridad del entorno bloqueó el borrado
automático y no se sorteó. Los logs de esas corridas se conservan en `evidence\`.
