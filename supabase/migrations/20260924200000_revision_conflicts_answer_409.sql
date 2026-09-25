-- Revision conflicts answer at once instead of spinning for two minutes.
--
-- Business-level optimistic-concurrency refusals ("revision desactualizada",
-- "conflicto de estado", stale rider/offer versions...) were raised with
-- SQLSTATE 40001. PostgREST treats 40001 as a transient serialization failure
-- and re-runs the whole transaction; a stale revision never becomes current,
-- so the request spun until the API gateway answered 504 "upstream request
-- timeout" after ~125 s, holding a pooled connection the whole time. Measured
-- on Staging on 2026-09-24: one stale transition_order call = 125 821 ms, and
-- the losing side of two operators accepting the same order hung the same way.
--
-- Conflicts are now raised as PT409, which PostgREST maps to HTTP 409 with
-- code PT409 and never retries. Clients treat 40001 and PT409 alike.
--
-- The current definitions are rewritten in place from the catalog, so no
-- historical body is copied and every overload/renamed helper is covered.
-- CREATE OR REPLACE keeps owner, grants, SECURITY DEFINER and search_path.
do $revision_conflicts$
declare
  r record;
  v_def text;
  v_new text;
  v_count integer := 0;
begin
  for r in
    select p.oid, p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prokind in ('f', 'p')
       and p.prosrc ~ 'errcode\s*=\s*''40001'''
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def, 'errcode(\s*)=(\s*)''40001''', 'errcode\1=\2''PT409''', 'g');
    if v_new = v_def then
      raise exception 'revision conflict rewrite made no change in %', r.signature;
    end if;
    execute v_new;
    v_count := v_count + 1;
  end loop;

  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prosrc ~ 'errcode\s*=\s*''40001'''
  ) then
    raise exception 'revision conflicts are still raised as 40001';
  end if;

  raise notice 'revision conflict functions now answering PT409: %', v_count;
end
$revision_conflicts$;
