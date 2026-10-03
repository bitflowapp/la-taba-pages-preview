select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.businesses'::regclass
  and contype = 'c'
order by conname;
