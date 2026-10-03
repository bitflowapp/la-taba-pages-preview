select t.tgname, c.relname as table_name, p.proname as function_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid
where c.relnamespace = 'auth'::regnamespace
  and c.relname='users'
  and not t.tgisinternal
order by t.tgname;

select * from information_schema.columns
where table_schema='auth' and table_name='users'
  and column_name in ('encrypted_password','raw_user_meta_data','raw_app_meta_data')
