import { supabase } from '../supabaseClient.js';

// Verifies the Supabase access token sent from the frontend
// (Authorization: Bearer <token>) and attaches the user + profile
// to the request object.
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No auth token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return res.status(401).json({ error: 'Profile not found' });
    }

    req.user = user;
    req.profile = profile;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed', details: err.message });
  }
}

// Restricts a route to admin-role users only. Use after requireAuth.
export function requireAdmin(req, res, next) {
  if (req.profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
