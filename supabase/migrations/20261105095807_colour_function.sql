-- WO-0040 migration 3: colour handling (LLD 4.3). Swatches are seeded by supabase/seed/lookups.sql.
create table catalog.colour_family_ref (
  id serial primary key,
  family text not null references catalog.lk_colour_family(code),
  hex char(7) not null,
  l float8 not null, a float8 not null, b float8 not null   -- CIELAB, filled by the seed
);
alter table catalog.colour_family_ref enable row level security;
alter table catalog.colour_family_ref force row level security;
create policy colour_family_ref_read on catalog.colour_family_ref for select to authenticated using (true);
grant select on catalog.colour_family_ref to authenticated;
grant all on catalog.colour_family_ref to service_role;
grant usage on sequence catalog.colour_family_ref_id_seq to service_role;

create function catalog.srgb_lin(p_c float8) returns float8 language sql immutable as $$
  select case when p_c <= 0.04045 then p_c/12.92 else power((p_c+0.055)/1.055, 2.4) end $$;

create function catalog.rgb_to_lab(p_r int, p_g int, p_b int) returns float8[]
language plpgsql immutable strict as $$
declare rl float8 := catalog.srgb_lin(p_r/255.0); gl float8 := catalog.srgb_lin(p_g/255.0); bl float8 := catalog.srgb_lin(p_b/255.0);
        x float8; y float8; z float8; fx float8; fy float8; fz float8;
begin
  x := (0.4124564*rl + 0.3575761*gl + 0.1804375*bl) / 0.95047;
  y :=  0.2126729*rl + 0.7151522*gl + 0.0721750*bl;
  z := (0.0193339*rl + 0.1191920*gl + 0.9503041*bl) / 1.08883;
  fx := case when x > 0.008856 then cbrt(x) else 7.787*x + 16.0/116 end;
  fy := case when y > 0.008856 then cbrt(y) else 7.787*y + 16.0/116 end;
  fz := case when z > 0.008856 then cbrt(z) else 7.787*z + 16.0/116 end;
  return array[116*fy - 16, 500*(fx - fy), 200*(fy - fz)];
end $$;

-- Nearest reference swatch by squared CIE76 distance. Departure from LLD 4.3 (the only one): ties are broken by
-- c.id (seed order), so the first listed swatch wins, as in the TypeScript colourFamily.
create function catalog.colour_family(p_r int, p_g int, p_b int) returns text
language sql stable strict as $$
  with q as (select catalog.rgb_to_lab(p_r, p_g, p_b) as lab)
  select c.family from catalog.colour_family_ref c, q
  order by power(c.l - q.lab[1], 2) + power(c.a - q.lab[2], 2) + power(c.b - q.lab[3], 2), c.id
  limit 1 $$;

-- "#RRGGBB" for a colour; null when any channel is null
create function catalog.rgb_hex(p_r int, p_g int, p_b int) returns text language sql immutable strict as $$
  select '#' || upper(lpad(to_hex(p_r), 2, '0') || lpad(to_hex(p_g), 2, '0') || lpad(to_hex(p_b), 2, '0')) $$;

-- Colour trigger (LLD 4.3), attached to app.items and app.wishlist_entries in WO-0041. Runs as the caller.
create function catalog.set_colour_fields() returns trigger language plpgsql as $$
begin
  new.colour_hex := catalog.rgb_hex(new.colour_r, new.colour_g, new.colour_b);
  new.colour_family := case when coalesce(new.is_multicolour, false) then 'Multi'
    else catalog.colour_family(new.colour_r, new.colour_g, new.colour_b) end;  -- strict: null RGB gives null
  if tg_table_name = 'items' then  -- only items has a secondary colour; null unless all three channels are given
    new.colour2_hex := catalog.rgb_hex(new.colour2_r, new.colour2_g, new.colour2_b);
    new.colour2_family := catalog.colour_family(new.colour2_r, new.colour2_g, new.colour2_b);
  end if;
  return new;
end $$;

-- Functions are executable by PUBLIC by default (LLD 4.5): restrict to signed-in users and the secret-key client.
revoke execute on function catalog.srgb_lin(float8), catalog.rgb_to_lab(int, int, int), catalog.colour_family(int, int, int),
  catalog.rgb_hex(int, int, int), catalog.set_colour_fields() from public;
grant execute on function catalog.srgb_lin(float8), catalog.rgb_to_lab(int, int, int), catalog.colour_family(int, int, int),
  catalog.rgb_hex(int, int, int), catalog.set_colour_fields() to authenticated, service_role;
