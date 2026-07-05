import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Uses the SERVICE ROLE key — this key bypasses RLS, so it must
// ONLY ever be used on the backend server, never in frontend code.
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
