select proname, prosrc
from pg_proc
where pronamespace='public'::regnamespace and proname='import_catalog_batch';
