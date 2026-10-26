# Local PostgreSQL for financial-integrity tests

A disposable PostgreSQL on 127.0.0.1 (default port 55440, override `TABA_LOCAL_PG_PORT`). Nothing here can reach a hosted
project: databases must be named `taba_local_*`.

```text
TABA_PG_BIN=<folder with psql / pg_ctl / pg_dump / pg_restore>      # PostgreSQL 15+
pg_ctl -D <empty dir> init;  pg_ctl -D <dir> -o "-p 55440 -c fsync=off" start      # trust auth, loopback only
node scripts/local-db/bootstrap.mjs taba_local_base --up-to 20261021235000_security_hardening.sql   # audited schema
node scripts/local-db/clone.mjs taba_local_work                                                      # base + newer migrations
TABA_LOCAL_DB=taba_local_work node --test --test-concurrency=1 tests/db/*.test.mjs
node scripts/local-db/run-sql-tests.mjs <clone> supabase/tests/<file>.sql      # repository pgTAP tests (use a CLONE)
```

`stubs.sql` models `pg_cron`, `pg_net` and Vault with plain tables; `pgtap-shim.sql` implements the few pgTAP
assertions the repository uses. Keep `taba_local_base` / `taba_local_work` clean: some repository SQL tests commit
their fixtures, so they are refused on the templates.

For an existing server distribution without `psql`, `TABA_LOCAL_PG_DRIVER=pg`
uses the locked Node driver instead. Both synchronous and concurrent tests
still accept only loopback and disposable `taba_local_*` databases.
