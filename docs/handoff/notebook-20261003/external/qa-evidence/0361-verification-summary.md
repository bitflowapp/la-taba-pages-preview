# TABA relay reliable sync - verification summary

## Scope

- Branch: `feature/catalog-checkout-premium`
- HEAD: `4197bdbc1df7d3eb1328afc4a7a01e1067f14316`
- Room: `primera-entrega-3`
- Relay: `https://correct-shut-situated-rise.trycloudflare.com`
- Runtime relay PID: `17908`
- Preserved tunnel PID: `18480`
- Persistence: enabled at `C:\1212\artifacts\taba-relay-reliable-sync\state`

## Reproduction before edits

The old relay accepted a newer order and then accepted a stale empty snapshot. Both responses were only `{"ok":true,"delivered":0}`. A late SSE client received `orders:[]`, `GET /snapshot` returned the SPA HTML, and no revision or authoritative state existed.

## Implemented contract

- Authoritative room snapshot with monotonic revision, updated time, publisher and connected-client count.
- Required high-entropy key for `/events`, `/publish`, `/snapshot` and `/reset`.
- Explicit snapshot endpoint and publish ACK with `accepted` and `revision`.
- Entity merge prevents stale clients from deleting or regressing newer orders.
- Client keeps only the latest pending snapshot and retries with bounded backoff.
- Recovery uses startup snapshot, SSE, polling fallback, `online`, `pageshow`, foreground and view-entry events.
- Visible `Sincronizado`, `Reconectando` and `Sin conexión` state with last sync time and manual retry.
- Persistence is opt-in through `TABA_RELAY_STATE_DIR`, atomic, TTL-bound and stores only the key hash.
- Perfil remains local and appears remotely only inside a confirmed order; there is no standalone profile message.

## Final gates

- `npm run check`: passed.
- `npm test`: 605 passed, 0 failed, 13.89 s test duration.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.
- Reliability focal: 7 passed, 0 failed, 7.0 s.
- Related focal: 13 passed, 0 failed, 19.9 s.
- Full E2E final run 1: 111 passed, 0 failed, 2.6 min.
- Full E2E final run 2: 111 passed, 0 failed, 2.5 min.

## Isolation evidence

- Reliability focal asserted zero Supabase network requests.
- Reliability focal asserted zero page errors and zero application console errors.
- All customer/order values used by the new spec are explicitly synthetic.
- Missing key returned 401; wrong key returned 403.
- Persisted room file does not contain the raw room key.
- No `skip`, `fixme`, retries override or `waitForTimeout` exists in the new reliability spec.

## Runtime validation

- Local health: `ok=true`, `persistence=true`.
- Public health: `ok=true`, `persistence=true`.
- Public page: HTTP 200.
- Public snapshot: room `primera-entrega-3`, revision 1, empty initial order state.
- The existing Cloudflare tunnel remained running and was not restarted.

## Safety

This relay remains demo infrastructure. The room key is a shared secret in the URL, not production identity, authorization, audit, rate limiting or durable multi-tenant storage. Do not use it as a production order backend.

No commit, push, merge, deploy, migration, RLS change, Supabase change, router change or firewall change was performed.
