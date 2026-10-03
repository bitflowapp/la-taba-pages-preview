# Gate 2 rider concurrency evidence

Project: `ukxqbgswjlibmnjemrzd`  
Business: `00000000-0000-4000-8000-000000000001`  
Order: `5a054a7d-0482-4583-b4a8-bd72488f87b8` / `LT-0003`

QA riders:

- Rider 1: `f9e25d87-7986-421e-a171-b3bfbf025a38`
- Rider 2: `ec906097-ac14-462c-a33c-d6218b140f4f`

Both have active `rider` memberships in the staging business. The second rider
was created as a reversible staging QA fixture; passwords are intentionally not
recorded.

Observed PostgreSQL result:

- initial eligible order: `ready`, revision `6`;
- concurrent claim winner: Rider 1;
- persisted result: `assigned`, revision `7`, assigned rider Rider 1;
- stale claim from Rider 2 with expected revision `6`: rejected with SQLSTATE
  `40001`, `revision desactualizada: esperada 6, actual 7`;
- repeated claim from Rider 1 with the old revision: `idempotent_no_op=true`,
  revision remained `7` and no new assignment was created.

The race request pair was issued from two independent Auth clients. The loser
HTTP request did not return before the client timeout, so the explicit loser
error above is the PostgreSQL RPC retry under the same stale revision; this is
not represented as a full HTTP-latency pass.
