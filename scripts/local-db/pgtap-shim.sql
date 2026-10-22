-- Minimal pgTAP stand-in for the disposable local cluster (the portable PostgreSQL ships without the extension).
-- It implements exactly the assertions the repository's SQL tests use, with pgTAP's output format and semantics.
create schema if not exists extensions;

create or replace function extensions.plan(n integer) returns text language plpgsql as $$
begin
  perform set_config('tap.planned', n::text, false);
  perform set_config('tap.count', '0', false);
  perform set_config('tap.failed', '0', false);
  return '1..' || n;
end $$;

create or replace function extensions.__tap_result(p_ok boolean, p_desc text, p_diag text default null) returns text
language plpgsql as $$
declare v_n integer := coalesce(nullif(current_setting('tap.count', true), ''), '0')::integer + 1;
begin
  perform set_config('tap.count', v_n::text, false);
  if not coalesce(p_ok, false) then
    perform set_config('tap.failed', (coalesce(nullif(current_setting('tap.failed', true), ''), '0')::integer + 1)::text, false);
  end if;
  return case when coalesce(p_ok, false) then 'ok ' else 'not ok ' end || v_n || ' - ' || coalesce(p_desc, '')
    || case when not coalesce(p_ok, false) and p_diag is not null then E'\n# ' || p_diag else '' end;
end $$;

create or replace function extensions.ok(p_ok boolean, p_desc text default null) returns text language sql as
$$ select extensions.__tap_result(p_ok, p_desc) $$;

create or replace function extensions.is(p_have anyelement, p_want anyelement, p_desc text default null) returns text language sql as
$$ select extensions.__tap_result(p_have is not distinct from p_want, p_desc,
     'have: ' || coalesce(p_have::text, 'NULL') || ' want: ' || coalesce(p_want::text, 'NULL')) $$;

create or replace function extensions.isnt(p_have anyelement, p_want anyelement, p_desc text default null) returns text language sql as
$$ select extensions.__tap_result(p_have is distinct from p_want, p_desc, 'both: ' || coalesce(p_have::text, 'NULL')) $$;

create or replace function extensions.throws_ok(p_sql text, p_errcode text, p_errmsg text, p_desc text) returns text
language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
    return extensions.__tap_result(false, p_desc, 'no exception raised');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  return extensions.__tap_result(
    (p_errcode is null or v_state = p_errcode) and (p_errmsg is null or v_msg = p_errmsg), p_desc,
    'raised ' || v_state || ': ' || v_msg);
end $$;
create or replace function extensions.throws_ok(p_sql text, p_errcode text, p_desc text) returns text language sql as
$$ select extensions.throws_ok(p_sql, p_errcode, null::text, p_desc) $$;
create or replace function extensions.throws_ok(p_sql text, p_errcode text) returns text language sql as
$$ select extensions.throws_ok(p_sql, p_errcode, null::text, null::text) $$;

create or replace function extensions.lives_ok(p_sql text, p_desc text default null) returns text language plpgsql as $$
begin
  execute p_sql;
  return extensions.__tap_result(true, p_desc);
exception when others then
  return extensions.__tap_result(false, p_desc, sqlstate || ': ' || sqlerrm);
end $$;

create or replace function extensions.finish() returns setof text language plpgsql as $$
declare v_planned integer := nullif(current_setting('tap.planned', true), '')::integer;
        v_count integer := coalesce(nullif(current_setting('tap.count', true), ''), '0')::integer;
        v_failed integer := coalesce(nullif(current_setting('tap.failed', true), ''), '0')::integer;
begin
  if v_planned is distinct from v_count then
    return next '# Looks like you planned ' || coalesce(v_planned::text, 'NULL') || ' tests but ran ' || v_count;
  end if;
  if v_failed > 0 then return next '# Looks like you failed ' || v_failed || ' test(s) of ' || v_count; end if;
end $$;
