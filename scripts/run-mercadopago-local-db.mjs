// Compatibility entrypoint. The runner owns its entire disposable cluster;
// TABA_SUPABASE_DB_CONTAINER can no longer redirect tests into another project.
import './run-release-v5-db.mjs';
