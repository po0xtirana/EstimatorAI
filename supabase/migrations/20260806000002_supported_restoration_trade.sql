insert into trade_catalog (slug, name_en, name_fr, parent_slug)
values ('restoration', 'Restoration', 'Restauration', 'general-renovation')
on conflict (slug) do update set name_en = excluded.name_en, name_fr = excluded.name_fr, parent_slug = excluded.parent_slug, active = true;
