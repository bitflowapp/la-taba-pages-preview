-- V5 CONTRACT is a durable release-ID operation. Local JSON is never evidence.
-- One transaction checks/consumes the trusted release and its drain attestation.
select private.execute_a1_a4_contract_v5($1::uuid, $2::text);
