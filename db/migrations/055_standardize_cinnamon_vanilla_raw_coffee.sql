begin;

update inventory_items as item
set
  name = 'Raw Coffee - Meeting Coffee Cinnamon Vanilla Medium Roast',
  sku = case
    when item.sku = 'RAW-COF-MTC-CIN-VAN-MED' then item.sku
    when not exists (
      select 1
      from inventory_items existing
      where existing.sku = 'RAW-COF-MTC-CIN-VAN-MED'
        and existing.id <> item.id
    ) then 'RAW-COF-MTC-CIN-VAN-MED'
    else item.sku
  end,
  updated_at = now()
where item.item_type = 'raw_coffee'
  and (
    (lower(item.name) like '%cinnamon%' and lower(item.name) like '%vanilla%' and lower(item.name) like '%medium%')
    or (lower(coalesce(item.sku, '')) like '%cin%' and lower(coalesce(item.sku, '')) like '%van%')
  );

commit;
