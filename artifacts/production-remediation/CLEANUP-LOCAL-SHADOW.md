# Limpieza del stack local de esta mision

**Pendiente.** El daemon de Docker de esta maquina quedo colgado por un error de
E/S de disco en su almacen de imagenes:

```
failed commit on ref "layer-sha256:17caa96af9ef...":
  commit failed: failed to perform sync:
  sync /var/lib/desktop-containerd/daemon/io.containerd.content.v1.content/ingest/...: input/output error
```

Aparecio al intentar `supabase db dump` (que necesita bajar la imagen
`public.ecr.aws/supabase/postgres:17.6.1.155`). Despues de eso `docker info`,
`docker ps` y `docker version` dejaron de responder: se cuelgan hasta el timeout.

El fallo es **posterior** a que la suite completa corriera y pasara (376/376) y
**no** afecta a produccion: la remediacion ya estaba aplicada y verificada contra
la base por Management API, que no pasa por Docker.

## Lo que hay que borrar — y NADA mas

Esta mision creo **5 containers**, todos con el sufijo
`taba2-prod-remediation-shadow`:

```
supabase_db_taba2-prod-remediation-shadow
supabase_kong_taba2-prod-remediation-shadow
supabase_auth_taba2-prod-remediation-shadow
supabase_rest_taba2-prod-remediation-shadow
supabase_storage_taba2-prod-remediation-shadow
```

En la maquina hay **23 containers historicos** de otros trabajos
(`la-taba-pages`, `taba2-rider-commercial-review`, `taba2-rider-rc1-manual`,
`taba2-identity-db`, `taba2-resilience-db`, `taba2_dispatch_verify`, ...).
**Ninguno se toco y ninguno debe tocarse.**

## Como limpiar, cuando Docker vuelva

Recuperar el daemon primero (Docker Desktop → Restart, o reiniciar el servicio).
Despues, la via limpia y acotada:

```bash
cd "E:/DevCache/Temp/claude/D--1212-worktrees-taba2-production-backend-remediation/6c564680-fbed-449f-a9f7-b2517fc2d40c/scratchpad/shadow"
supabase stop --no-backup
```

`supabase stop` en ese directorio usa su `config.toml`, cuyo `project_id` es
`taba2-prod-remediation-shadow`, asi que solo alcanza a los 5 containers de esta
mision.

Verificacion, y borrado manual solo si `supabase stop` no llegara a correr:

```bash
docker ps -a --filter "name=taba2-prod-remediation-shadow" --format "{{.Names}}"
docker rm -f $(docker ps -aq --filter "name=taba2-prod-remediation-shadow")
docker volume ls --filter "name=taba2-prod-remediation-shadow" --format "{{.Name}}"
docker volume rm $(docker volume ls -q --filter "name=taba2-prod-remediation-shadow")
```

## PROHIBIDO

```
docker system prune
docker container prune
docker volume prune
docker image prune
```

Cualquiera de esos se llevaria puestos los 23 containers historicos.

## Directorios temporales

Todo el material de trabajo vive fuera del repositorio, en el scratchpad de la
sesion, y se puede borrar entero sin consecuencias:

```
E:/DevCache/Temp/claude/D--1212-worktrees-taba2-production-backend-remediation/6c564680-fbed-449f-a9f7-b2517fc2d40c/scratchpad/
  shadow/         stack local (config.toml, migrations, tests)
  remote-probe/   directorio aislado usado para las consultas de solo lectura
  *.json *.sh     retratos y helpers
```
