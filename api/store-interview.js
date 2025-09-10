import { put } from '@vercel/blob';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    await new Promise((resolve) => req.on('end', resolve));

    const buffer = Buffer.concat(chunks);
    const fileName = req.headers['x-filename'] || `interview_${Date.now()}.zip`;
    const contentType = req.headers['content-type'] || 'application/zip';

    const { url } = await put(fileName, buffer, { access: 'private', contentType });

    return res.status(200).json({ success: true, url, fileName });
  } catch (e) {
    console.error('Store error', e);
    return res.status(500).json({ error: 'Failed to store interview' });
  }
}
