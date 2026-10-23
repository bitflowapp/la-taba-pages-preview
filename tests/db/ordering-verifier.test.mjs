// Real foreign-key actions, CHECK constraints and an explicit retirement, always rolled back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { psqlRaw } from '../../scripts/local-db/lib.mjs';

const db = process.env.TABA_LOCAL_DB || 'taba_local_base';
function run(body) {
  return psqlRaw(db, `begin; set local statement_timeout='10s';
    do $test$ declare u uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c text;
      p uuid := gen_random_uuid(); v uuid := gen_random_uuid();
    begin
      insert into auth.users(id,email) values(u, u::text||'@example.invalid');
      insert into public.businesses(id,name,slug,status,is_active,ordering_enabled,ordering_verified,
        ordering_verified_at,ordering_verified_by,currency_code,pickup_enabled)
      values(b,'Verifier regression',b::text,'open',true,true,true,clock_timestamp(),u,'ARS',true);
      ${body}
    end $test$; rollback;`);
}

test('deleting a verifier is explicitly restricted and preserves the valid commercial configuration', () => {
  assert.doesNotThrow(() => run(`
    begin
      delete from auth.users where id=u;
      raise exception 'verifier deletion unexpectedly succeeded';
    exception when foreign_key_violation then
      get stacked diagnostics c=constraint_name;
      if c <> 'businesses_ordering_verified_by_fkey' then raise exception 'wrong FK: %',c; end if;
    end;
    if not exists(select 1 from public.businesses where id=b and ordering_enabled and ordering_verified
       and ordering_verified_by=u and ordering_verified_at is not null)
    then raise exception 'commercial configuration changed'; end if;
  `));
});

test('clearing the verifier alone still fails closed; explicit retirement permits deletion', () => {
  assert.doesNotThrow(() => run(`
    begin
      update public.businesses set ordering_verified_by=null where id=b;
      raise exception 'invalid verification accepted';
    exception when check_violation then null; end;
    update public.businesses set ordering_enabled=false,ordering_verified=false,
      ordering_verified_at=null,ordering_verified_by=null where id=b;
    delete from auth.users where id=u;
    if exists(select 1 from auth.users where id=u) then raise exception 'retired verifier retained'; end if;
    if not exists(select 1 from public.businesses where id=b and not ordering_enabled and not ordering_verified)
    then raise exception 'retired business changed'; end if;
  `));
});

test('reassigning verification keeps ordering active and permits deleting the former verifier', () => {
  assert.doesNotThrow(() => run(`
    insert into auth.users(id,email) values(gen_random_uuid(),'replacement-'||b::text||'@example.invalid');
    update public.businesses set ordering_verified_by=(select id from auth.users
      where email='replacement-'||b::text||'@example.invalid'),ordering_verified_at=clock_timestamp() where id=b;
    delete from auth.users where id=u;
    if not exists(select 1 from public.businesses where id=b and ordering_enabled and ordering_verified
       and ordering_verified_by is not null and ordering_verified_by<>u)
    then raise exception 'reassigned verification lost'; end if;
  `));
});

test('commercial product verification also retains its verifier until explicitly retired',()=>{
  assert.doesNotThrow(()=>run(`
    insert into auth.users(id,email) values(v,v::text||'@example.invalid');
    insert into public.products(id,business_id,name,brand,category,subcategory,presentation,capacity,packaging_type,
      price,stock,is_alcoholic,is_active,is_verified,available,verified_at,verified_by,catalog_origin,sku,external_id,
      variant,capacity_value,capacity_unit,price_status)
    values(p,b,'Verified beverage','Synthetic','Gaseosas','Cola','Botella 1 l','1 l','botella',1250,10,false,
      true,true,true,clock_timestamp(),v,'commercial',p::text,p::text,'Botella 1 l',1,'l','confirmed');
    begin
      delete from auth.users where id=v;
      raise exception 'commercial product verifier deletion unexpectedly succeeded';
    exception when foreign_key_violation then
      get stacked diagnostics c=constraint_name;
      if c<>'products_verified_by_fkey' then raise exception 'wrong FK: %',c; end if;
    end;
    if not exists(select 1 from public.products where id=p and is_verified and available and verified_by=v)
      then raise exception 'product publication changed'; end if;
    update public.products set available=false,is_verified=false,verified_at=null,verified_by=null where id=p;
    delete from auth.users where id=v;
    if exists(select 1 from auth.users where id=v) then raise exception 'retired product verifier retained'; end if;
  `));
});
