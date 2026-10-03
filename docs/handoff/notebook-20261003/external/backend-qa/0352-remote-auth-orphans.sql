select u.id, u.email, u.confirmed_at, u.confirmed_at is not null as confirmed
from auth.identities i
join auth.users u on u.id = i.user_id
order by u.created_at desc
limit 50;

select id, provider, provider_id, user_id
from auth.identities
order by user_id, provider;
