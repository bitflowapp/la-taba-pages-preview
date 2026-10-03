# Temporary Access / JIT status

- Project: `ukxqbgswjlibmnjemrzd` (`la-taba-staging`) only.
- PostgreSQL: 17.6; compatible with Supabase Temporary Access/JIT.
- SSL Enforcement: `database=true`, applied successfully, and retained enabled.
- Initial JIT state: disabled.
- Temporary grant during certification: platform user redacted; role `postgres` only; staging-project scope; short expiry; IPv4/IPv6 source restrictions.
- Connection proof while granted: TLS connection as `postgres`.
- Finalization: JIT mapping DELETE returned HTTP 200; JIT disable returned HTTP 200; final state `disabled`.
- Post-revocation proof: a fresh JIT PostgreSQL connection was rejected (`28P01`).

No permanent PostgreSQL password was created or reset. The Management PAT was process-local only and is not present in this artifact.
