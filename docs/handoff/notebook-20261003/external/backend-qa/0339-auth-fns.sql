select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='extensions'
  or n.nspname='auth'
  or n.nspname='public'
order by n.nspname, p.proname;
