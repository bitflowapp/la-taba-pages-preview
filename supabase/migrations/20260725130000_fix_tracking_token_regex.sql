do $migration$
declare
  v_signature regprocedure;
  v_definition text;
  v_corrected text;
begin
  foreach v_signature in array array[
    'public.create_order_with_items_core(jsonb)'::regprocedure,
    'public.issue_order_delivery_code(uuid,text)'::regprocedure,
    'public.recover_order_tracking_access(uuid,text)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_signature)
      into v_definition;

    v_corrected := replace(
      v_definition,
      '^[A-Za-z0-9_-]{32,256}$',
      '^[A-Za-z0-9_-]{32,255}[A-Za-z0-9_-]?$'
    );

    if v_corrected = v_definition then
      raise exception 'tracking token regex not found in %', v_signature;
    end if;

    execute v_corrected;
  end loop;
end;
$migration$;
