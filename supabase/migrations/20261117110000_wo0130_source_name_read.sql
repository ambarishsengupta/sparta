-- WO-0130 part (4): a signed-in person reads the id and name of a catalogue source that has at least one active item, and nothing else about it.
-- Why a column grant and not a view: the catalogue reads embed the source name through the foreign key of catalog_items (one request, no second round trip),
-- and PostgREST embeds follow a real foreign key to a table, not to a view. The grant is on (id, name) only: site_url, the terms and robots notes, the
-- contact and the take-down fields stay unreadable, and nothing is writable. The policy shows a source only while an active item points at it; the
-- subquery runs as the caller, so it sees exactly the active rows catalog_items_consumer_select lets that person see.
-- anon gets nothing (it has no grant on catalog.sources and no policy).
grant select (id, name) on catalog.sources to authenticated;
create policy sources_consumer_name_select on catalog.sources for select to authenticated using (
  exists (select 1 from catalog.catalog_items i where i.source_id = sources.id and i.status = 'active'));
