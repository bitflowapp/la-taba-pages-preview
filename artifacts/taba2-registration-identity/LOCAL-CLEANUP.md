# TABA2 · Limpieza del entorno local de esta misión

Nada quedó corriendo, y nada de lo que había antes se tocó.

## 1. Stack shadow

Se **reutilizaron** los 5 containers que la misión anterior dejó, en vez de crear
otros 5. Mismo `project_id`, mismos puertos:

```
supabase_db_taba2-prod-remediation-shadow
supabase_kong_taba2-prod-remediation-shadow
supabase_auth_taba2-prod-remediation-shadow
supabase_rest_taba2-prod-remediation-shadow
supabase_storage_taba2-prod-remediation-shadow
```

Detenidos y removidos al terminar:

```
$ supabase stop --no-backup
{"project_id_filter":"taba2-prod-remediation-shadow","backup":false,
 "message":"Stopped supabase local development setup."}

$ docker ps -a | wc -l                                    → 23
$ docker ps -a --filter name=taba2-prod-remediation-shadow → 0
```

**23 containers históricos antes, 23 después.** Ninguno de los de otros trabajos
—`la-taba-pages`, `taba2-rider-commercial-review`, `taba2-rider-rc1-manual`,
`taba2-identity-db`, `taba2-resilience-db`, `taba2_dispatch_verify`, …— se tocó.
No se corrió ningún `prune`.

Con esto queda además cerrada la limpieza que
`artifacts/production-remediation/CLEANUP-LOCAL-SHADOW.md` dejó pendiente.

## 2. Docker Desktop

El daemon estaba colgado al empezar —lo documentó la misión anterior— y hubo que
reiniciarlo tres veces durante el trabajo. La causa concreta, leída del log:

```
starting services: initializing Backend API: listening on \\.\pipe\dockerBackendApiServer:
Acceso denegado. (listener: Todas las instancias de canalización están en uso.)
```

Dos procesos `com.docker.backend` se peleaban el named pipe. Se resolvió matando
**todos** los procesos de Docker y volviendo a arrancar Docker Desktop; los
containers no se pierden con eso, sólo se detienen.

## 3. `node_modules`

Este worktree no tiene dependencias instaladas, y Playwright hace falta para el
E2E. Para no bajar ~400 MB de nuevo se creó una **junction** hacia el
`node_modules` del repositorio principal, se corrió el E2E, y **se removió al
terminar**. El `node_modules` del repositorio principal quedó intacto.

Para volver a correr el E2E en este worktree hace falta una de las dos:

```bash
npm ci
# o, más rápido y sin red: una junction hacia el node_modules del clon
# principal del repositorio (`<clon-principal>/node_modules`), con
# New-Item -ItemType Junction.
```

La segunda tiene un costo que conviene saber: este worktree seguiría en silencio
los cambios de dependencias del otro repositorio.

## 4. Vínculo del proyecto Supabase

`supabase link --project-ref wwcpogltfgzgkrlilbcd` dejó
`supabase/.temp/project-ref`, que está en `.gitignore` y por lo tanto no se
versiona. Se conserva a propósito: la guardia de destino lo lee como CHECK D y
un worktree vinculado al proyecto correcto es una defensa, no un residuo.

## 5. Directorios temporales

Todo el material de trabajo vive fuera del repositorio, en el scratchpad de la
sesión, y se puede borrar entero sin consecuencias:

```
<scratchpad>/shadow/         config, migraciones y tests del stack local
<scratchpad>/*.log           logs del smoke, del push y de los controles negativos
<scratchpad>/*.json          retratos crudos y reportes de Playwright
<scratchpad>/*.sql           consultas de sonda y de limpieza
```

Lo que había que conservar ya está copiado —y saneado— en este directorio de
artefactos.

## PROHIBIDO, y no se hizo

```
docker system prune
docker container prune
docker volume prune
docker image prune
```
