import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// FIX: previously used `|| ''` which silently created a broken client;
// now throws at startup so misconfiguration is immediately obvious.
if (!url) {
  throw new Error(
    'Missing env var NEXT_PUBLIC_SUPABASE_URL. ' +
    'Add it to .env.local and restart the dev server.'
  );
}
if (!key) {
  throw new Error(
    'Missing env var NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Add it to .env.local and restart the dev server.'
  );
}

export const supabase = createClient(url, key);
