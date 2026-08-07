-- Local preview needs a real organization row so its write flows can be demonstrated.
-- Production auth never uses this context; it is only returned by the localhost preview cookie.
insert into public.organizations (id, name, default_currency, industry)
values ('00000000-0000-0000-0000-000000000000', 'Demo organization', 'CAD', 'Construction')
on conflict (id) do nothing;
