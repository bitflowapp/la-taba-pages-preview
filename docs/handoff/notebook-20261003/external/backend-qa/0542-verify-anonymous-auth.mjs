import { createRequire } from 'node:module';

const WORKTREE_PACKAGE = 'C:\\1212\\la-taba-s23-iphone-test\\package.json';
const SUPABASE_URL = 'https://yakhtrkukqlgzvxuvhzs.supabase.co';
const requireFromWorktree = createRequire(WORKTREE_PACKAGE);
const { createClient } = requireFromWorktree('@supabase/supabase-js');

let publishableKey = process.env.TABA_QA_SUPABASE_PUBLISHABLE || '';
if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey)) {
  console.log(JSON.stringify({ status: 0, message: 'publishable_key_unavailable' }));
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, publishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
delete process.env.TABA_QA_SUPABASE_PUBLISHABLE;

const { data, error } = await supabase.auth.signInAnonymously();
if (error) {
  console.log(JSON.stringify({
    status: Number(error.status) || 0,
    message: String(error.code || error.name || 'anonymous_sign_in_failed'),
  }));
  publishableKey = '';
  process.exit(1);
}

const succeeded = Boolean(data?.session?.access_token && data?.user?.is_anonymous);
console.log(JSON.stringify({
  status: succeeded ? 200 : 0,
  message: succeeded ? 'anonymous_sign_in_ok' : 'anonymous_session_missing',
}));
await supabase.auth.signOut({ scope: 'local' });
publishableKey = '';
