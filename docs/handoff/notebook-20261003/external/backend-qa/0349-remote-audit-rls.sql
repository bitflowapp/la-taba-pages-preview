select schemaname, tablename, rowsecurity from pg_tables
where schemaname in ('public','storage','auth')
and tablename in ('businesses','orders','products','business_members','order_events','order_public_tokens','rider_locations','customer_addresses','customers')
order by 1,2;
