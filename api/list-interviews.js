import { list } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    const result = await list({ prefix: 'interviews/' });
    // Return only minimal info
    const files = result.blobs.map(b => ({
      pathname: b.pathname,
      url: b.url,
      size: b.size,
      uploadedAt: b.uploadedAt
    }));
    res.status(200).json({ files });
  } catch (e) {
    console.error('List error', e);
    res.status(500).json({ error: 'Failed to list interviews' });
  }
}
