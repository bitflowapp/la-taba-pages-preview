select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='customers'
order by ordinal_position;

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='customer_addresses'
order by ordinal_position;

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='business_members'
order by ordinal_position;
