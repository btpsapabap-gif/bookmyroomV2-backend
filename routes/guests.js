import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { supabase } from '../supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isValidIndianMobile } from '../utils/validators.js';

const router = express.Router();

// Files are held in memory only long enough to forward to Supabase
// Storage — nothing is written to local disk. 5MB cap, images only.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed for ID proof.'));
    }
    cb(null, true);
  }
});

// GET /api/guests - list all guest profiles (admin only)
// Used to populate the "book on behalf of" guest selector and the
// admin guest/ID-proof management table.
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, mobile_number, role, id_proof_type, id_proof_number, created_at')
    .eq('role', 'guest')
    .order('full_name');

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/guests/walkin (admin only)
// Creates a guest account WITH ID proof in a single step, for a walk-in
// who isn't registered yet. If the mobile number already exists, reuses
// that profile and just attaches/updates the ID proof instead of erroring.
// Returns the guest's id, ready to pass straight into POST /api/bookings.
router.post('/walkin', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  const { full_name, mobile_number, id_proof_type, id_proof_number } = req.body;

  if (!full_name || !mobile_number || !id_proof_type || !id_proof_number || !req.file) {
    return res.status(400).json({ error: 'Guest name, mobile number, ID proof type, ID number, and a photo of the ID are all required.' });
  }
  if (!isValidIndianMobile(mobile_number)) {
    return res.status(400).json({ error: 'Mobile number must start with +91 followed by a 10-digit number (e.g. +919876543210).' });
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('mobile_number', mobile_number)
    .maybeSingle();

  let guestId;
  if (existing) {
    guestId = existing.id;
  } else {
    const randomPassword = Math.random().toString(36).slice(-10);
    const password_hash = await bcrypt.hash(randomPassword, 10);
    const { data: created, error: createError } = await supabase
      .from('profiles')
      .insert([{ full_name, mobile_number, password_hash, role: 'guest' }])
      .select('id')
      .single();
    if (createError) return res.status(400).json({ error: createError.message });
    guestId = created.id;
  }

  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const storagePath = `${guestId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase
    .storage
    .from('id-proofs')
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

  if (uploadError) return res.status(400).json({ error: uploadError.message });

  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({ id_proof_type, id_proof_number, id_proof_image_path: storagePath })
    .eq('id', guestId)
    .select('id, full_name, mobile_number')
    .single();

  if (updateError) return res.status(400).json({ error: updateError.message });
  res.status(201).json(updated);
});

// GET /api/guests/:id/id-proof
// Returns ID proof metadata + a short-lived signed URL to view the image.
// A guest may view their own; an admin may view anyone's.
router.get('/:id/id-proof', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (req.user.id !== id && req.profile.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to view this ID proof.' });
  }

  const { data: p, error } = await supabase
    .from('profiles')
    .select('id_proof_type, id_proof_number, id_proof_image_path')
    .eq('id', id)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  let image_url = null;
  if (p.id_proof_image_path) {
    const { data: signed } = await supabase
      .storage
      .from('id-proofs')
      .createSignedUrl(p.id_proof_image_path, 3600); // 1 hour
    image_url = signed?.signedUrl || null;
  }

  res.json({ id_proof_type: p.id_proof_type, id_proof_number: p.id_proof_number, image_url });
});

// PUT /api/guests/:id/id-proof
// Uploads/updates ID proof type, number, and optionally a new image.
// A guest may update their own; an admin may update anyone's
// (e.g. capturing ID for a walk-in at check-in time).
router.put('/:id/id-proof', requireAuth, upload.single('file'), async (req, res) => {
  const { id } = req.params;
  if (req.user.id !== id && req.profile.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to update this ID proof.' });
  }

  const { id_proof_type, id_proof_number } = req.body;
  const updateFields = {};
  if (id_proof_type) updateFields.id_proof_type = id_proof_type;
  if (id_proof_number) updateFields.id_proof_number = id_proof_number;

  if (req.file) {
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const storagePath = `${id}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase
      .storage
      .from('id-proofs')
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

    if (uploadError) return res.status(400).json({ error: uploadError.message });
    updateFields.id_proof_image_path = storagePath;
  }

  if (Object.keys(updateFields).length === 0) {
    return res.status(400).json({ error: 'Nothing to update — provide id_proof_type, id_proof_number, and/or an image file.' });
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updateFields)
    .eq('id', id)
    .select('id, id_proof_type, id_proof_number, id_proof_image_path')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

export default router;
