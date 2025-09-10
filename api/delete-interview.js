import { del } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { pathname } = await req.json?.() || req.body;
    if (!pathname) return res.status(400).json({ error: 'Missing pathname' });
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    await del(pathname, { token });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Delete error', e);
    return res.status(500).json({ error: 'Failed to delete interview' });
  }
}
