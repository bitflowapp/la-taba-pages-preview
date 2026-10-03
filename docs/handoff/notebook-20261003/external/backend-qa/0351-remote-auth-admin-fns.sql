select proname, proargnames
from pg_proc
where pronamespace = 'auth'::regnamespace
  and proname ilike 'create_%'
  and (prokind = 'f')
order by proname;
