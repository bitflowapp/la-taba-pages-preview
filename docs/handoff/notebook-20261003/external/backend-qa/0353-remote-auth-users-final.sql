select u.id, u.email, u.confirmed_at, i.provider
from auth.users u
left join auth.identities i on i.user_id = u.id
where u.email like '%staging@local.taba'
order by u.email;
