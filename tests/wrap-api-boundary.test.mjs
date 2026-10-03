import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  MARKER, WrapRefusal, wrapBody, raisesDirectly, exclusionMatcher, excludedPatterns, splitFunctionDef, dollarTagFor, bodyMd5,
} from '../scripts/db/wrap-api-boundary.mjs';

const contract = JSON.parse(readFileSync(new URL('../docs/ecommerce-hardening/http-contract.json', import.meta.url), 'utf8'));
const refusalCode = (fn) => {
  try { fn(); } catch (error) { assert.ok(error instanceof WrapRefusal, String(error)); return error.code; }
  assert.fail('expected a WrapRefusal');
};

const PLAIN = `
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  return to_jsonb(v_order);
end;
`;

test('a plain body becomes the nested block of a block with one handler, letter by letter', () => {
  const { body, alreadyWrapped } = wrapBody(PLAIN);
  assert.equal(alreadyWrapped, false);
  assert.ok(body.startsWith('\ndeclare\n'), 'the wrapper declare comes first');
  assert.ok(body.includes(MARKER));
  assert.ok(body.includes(PLAIN.trimEnd()), 'the original body is kept verbatim');
  assert.match(body, /\nexception\n {2}when sqlstate '55000' or sqlstate 'P0002' then\n/);
  assert.match(body, /current_setting\('request\.method', true\)/);
  assert.match(body, /string_to_array\(_api_context, E'\\n'\), 1\) = 1 then/);
  assert.match(body, /raise sqlstate 'PGRST' using/);
  assert.match(body, /case _api_state when 'P0002' then 404 else 409 end/);
  assert.ok(body.endsWith('    raise;\nend;\n'), 'a bare RAISE re-throws the original otherwise');
  // Las variables del envoltorio están en el declare de afuera, antes del cuerpo.
  assert.ok(body.indexOf('_api_context text;') < body.indexOf(PLAIN.trimEnd()));
});

test('#option compiler directives stay first', () => {
  const src = '\n#variable_conflict use_column\n#print_strict_params on\ndeclare\n  x int;\nbegin\n  return 1;\nend;\n';
  const { body } = wrapBody(src);
  assert.ok(body.startsWith('\n#variable_conflict use_column\n#print_strict_params on\ndeclare\n  -- '), body.slice(0, 120));
  assert.ok(body.includes('\nbegin\ndeclare\n  x int;\nbegin\n  return 1;\nend;\nexception\n'), 'the rest is the nested block');
});

test('a labelled body that ends without a semicolon gets only the semicolon', () => {
  const src = '\n<<main>>\ndeclare\n  x int;\nbegin\n  exit main when true;\n  return 1;\nend main\n';
  const { body } = wrapBody(src);
  assert.ok(body.includes('\nbegin\n\n<<main>>\ndeclare\n  x int;\nbegin\n  exit main when true;\n  return 1;\nend main;\nexception\n'));
});

test('a body ending in END without a semicolon is terminated', () => {
  const { body } = wrapBody('\nbegin\n  return 1;\nend');
  assert.ok(body.includes('\nbegin\n  return 1;\nend;\nexception\n'));
});

test('a CRLF body keeps its carriage returns and wraps like the LF one', () => {
  const crlf = '\r\n#variable_conflict use_column\r\ndeclare\r\n  x int;\r\nbegin\r\n  return 1;\r\nend;\r\n';
  const { body } = wrapBody(crlf);
  assert.ok(body.startsWith('\r\n#variable_conflict use_column\ndeclare\n'), JSON.stringify(body.slice(0, 60)));
  assert.ok(body.includes('declare\r\n  x int;\r\nbegin\r\n  return 1;\r\nend;\nexception\n'), 'the original lines keep their CR');
  assert.equal(bodyMd5(body), bodyMd5(wrapBody(crlf.replace(/\r/g, '')).body), 'the md5 guard ignores CR');
});

test('an already wrapped body is recognised by its marker and not wrapped twice', () => {
  const once = wrapBody(PLAIN).body;
  const twice = wrapBody(once);
  assert.equal(twice.alreadyWrapped, true);
  assert.equal(twice.body, once);
});

test('bodies it cannot handle are refused with a reason instead of guessed', () => {
  assert.equal(refusalCode(() => wrapBody('')), 'EMPTY_BODY');
  assert.equal(refusalCode(() => wrapBody('\ndeclare _api_state int;\nbegin\n  return 1;\nend;\n')), 'IDENTIFIER_COLLISION');
  assert.equal(refusalCode(() => wrapBody('\nselect 1;\n')), 'UNEXPECTED_START');
  assert.equal(refusalCode(() => wrapBody('\nbegin\n  return 1;\nend -- fin\n')), 'TRAILING_COMMENT');
  assert.equal(refusalCode(() => wrapBody('\nbegin\n  return 1;\nend; /* fin */\n')), 'TRAILING_COMMENT');
  assert.equal(refusalCode(() => wrapBody('\nbegin\n  return 1;\nend if;\nfoo\n')), 'UNEXPECTED_END');
});

test('the direct part of the selection rule', () => {
  assert.equal(raisesDirectly("raise exception 'x' using errcode = '55000';"), true);
  assert.equal(raisesDirectly("raise exception 'x' using errcode = 'P0002';"), true);
  assert.equal(raisesDirectly('select * into strict v from t;'), true);
  assert.equal(raisesDirectly('raise no_data_found;'), true);
  assert.equal(raisesDirectly("raise exception using errcode = 'object_not_in_prerequisite_state';"), true);
  assert.equal(raisesDirectly("-- raise exception 'x' using errcode = '55000';\nreturn 1;"), false, 'a comment is not a raise');
  assert.equal(raisesDirectly("raise exception 'x' using errcode = '22023';"), false);
});

test('exclusions come from http-contract.json and match by name or prefix', () => {
  const excluded = exclusionMatcher(contract.excluded);
  for (const [name, group] of [['pos_apply_stock_count', 'caja_pos'], ['checkout_pos_sale', 'caja_pos'], ['identity_register_session', 'caja_pos'],
    ['claim_fiscal_outbox', 'fiscal'], ['service_request_order_invoice', 'fiscal'], ['operator_create_local_device_pairing', 'print_agent'],
    ['agent_claim_print_jobs', 'print_agent'], ['prepare_payment_refund', 'legacy_payment_retired']]) {
    assert.equal(excluded(name)?.group, group, name);
  }
  for (const name of ['create_order_with_items', 'cancel_own_order', 'prepare_payment_refund_v2', 'identity_revoke_session', 'positions']) {
    assert.equal(excluded(name), null, name);
  }
  assert.equal(new Set(excludedPatterns(contract)).size, excludedPatterns(contract).length, 'no pattern twice');
});

test('the function header is taken exactly as pg_get_functiondef prints it', () => {
  const prosrc = '\nbegin\n  return 1;\nend;\n';
  const header = 'CREATE OR REPLACE FUNCTION public.f(p uuid)\n RETURNS integer\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO \'pg_catalog\', \'public\'\n';
  const def = `${header}AS $function$${prosrc}$function$\n`;
  assert.deepEqual(splitFunctionDef(def, prosrc), { header, tag: '$function$' });
  assert.equal(refusalCode(() => splitFunctionDef(def, '\nbegin\nend;\n')), 'UNPARSEABLE_FUNCTIONDEF');
  assert.equal(dollarTagFor('select 1'), '$function$');
  assert.equal(dollarTagFor('a $function$ b'), '$api_function$');
});
