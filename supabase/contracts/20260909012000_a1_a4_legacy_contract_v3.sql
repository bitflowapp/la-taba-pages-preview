\set ON_ERROR_STOP on

-- This file is intentionally not a migration. It contains no raw contract DDL:
-- the reviewed executor supplies exact bindings, and one private database
-- function revalidates the drain, changes the legacy RPCs, consumes the
-- attestation and records the durable execution in one transaction.
select private.execute_a1_a4_legacy_contract_v3(
  :'attestation_id'::uuid,
  :'environment',
  :'edge_version',
  :'contract_sha',
  :'expand_version',
  :'expand_sha',
  :'actor'
);
