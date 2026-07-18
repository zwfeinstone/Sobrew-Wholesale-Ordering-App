alter table public.inventory_receipts
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reversal_reason text;

create index if not exists inventory_receipts_reversed_at_idx
  on public.inventory_receipts(reversed_at);

create or replace function public.reverse_inventory_receipt(
  p_receipt_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lot record;
  v_quantity numeric := 0;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_receipt record;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.is_owner_admin() then
    raise exception 'Only superadmins can reverse inventory receipts.' using errcode = '42501';
  end if;

  if p_receipt_id is null then
    raise exception 'Receipt is required.' using errcode = '22023';
  end if;

  if v_reason is null then
    raise exception 'Reversal reason is required.' using errcode = '22023';
  end if;

  select *
    into v_receipt
    from public.inventory_receipts
    where id = p_receipt_id
    for update;

  if not found then
    raise exception 'Receipt not found.' using errcode = 'P0002';
  end if;

  if v_receipt.reversed_at is not null then
    raise exception 'Receipt is already reversed.' using errcode = '22023';
  end if;

  if v_receipt.lot_id is null then
    raise exception 'Receipt has no inventory lot to reverse.' using errcode = '22023';
  end if;

  select *
    into v_lot
    from public.inventory_lots
    where id = v_receipt.lot_id
    for update;

  if not found then
    raise exception 'Receipt inventory lot not found.' using errcode = 'P0002';
  end if;

  if v_lot.inventory_item_id <> v_receipt.inventory_item_id then
    raise exception 'Receipt inventory lot does not match the receipt item.' using errcode = '22023';
  end if;

  v_quantity := coalesce(v_receipt.quantity, 0);

  if v_quantity <= 0 then
    raise exception 'Receipt quantity must be greater than zero.' using errcode = '22023';
  end if;

  if coalesce(v_lot.quantity_remaining, 0) < v_quantity then
    raise exception 'Receipt lot has already been consumed and cannot be fully reversed.' using errcode = '22023';
  end if;

  update public.inventory_lots
  set quantity_remaining = quantity_remaining - v_quantity,
      notes = concat_ws(
        E'\n',
        nullif(notes, ''),
        'Receipt reversed on ' || now()::text || ': ' || v_reason
      )
  where id = v_lot.id;

  insert into public.inventory_movements (
    inventory_item_id,
    lot_id,
    receipt_id,
    movement_type,
    quantity_change,
    unit,
    unit_cost_cents,
    notes
  )
  values (
    v_receipt.inventory_item_id,
    v_lot.id,
    v_receipt.id,
    'adjustment',
    -v_quantity,
    v_receipt.unit,
    coalesce(v_receipt.landed_unit_cost_cents, 0),
    'Reversed receipt: ' || v_reason
  );

  update public.inventory_receipts
  set reversed_at = now(),
      reversed_by = (select auth.uid()),
      reversal_reason = v_reason
  where id = v_receipt.id;

  return v_receipt.id;
end;
$function$;

revoke all on function public.reverse_inventory_receipt(uuid, text)
  from public, anon, authenticated;

grant execute on function public.reverse_inventory_receipt(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
