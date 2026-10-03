# Live actors — staging

Business scope verified: `00000000-0000-4000-8000-000000000001`.

- QA operator: Auth session, active business membership, and owner/admin/staff role verified.
- Existing Rider A and Rider B: Auth and active Rider memberships verified; both had unrelated active deliveries and were not modified.
- Certification Rider A and Rider B: two new anonymous Supabase Auth sessions, each with a temporary active Rider membership scoped only to the staging business.
- Synthetic customer: anonymous Supabase Auth session, no human data and no persistent credential.

After the test, all eight temporary Rider memberships created by the certification attempts were inactive. Audit-linked synthetic identities were retained without active operational membership to avoid deleting legitimate audit references.
