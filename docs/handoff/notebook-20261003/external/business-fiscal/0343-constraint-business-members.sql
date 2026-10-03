select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.business_members'::regclass
  and contype = 'c';
