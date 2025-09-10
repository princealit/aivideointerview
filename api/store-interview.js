import { put } from '@vercel/blob';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(500).json({ error: 'Method not allowed' });

  try {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    await new Promise((resolve) => req.on('end', resolve));

    const buffer = Buffer.concat(chunks);
    const baseName = req.headers['x-filename'] || `interview_${Date.now()}.zip`;
    const fileName = baseName.startsWith('interviews/') ? baseName : `interviews/${baseName}`;
    const contentType = req.headers['content-type'] || 'application/zip';
    const metaData = JSON.parse(req.headers['x-meta'] || '{}');

    // Ensure token exists
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      console.error('❌ Missing BLOB_READ_WRITE_TOKEN');
      return res.status(500).json({ error: 'Storage token not configured' });
    }

    console.log('📤 Uploading interview:', {
      fileName,
      sizeMB: +(buffer.length / 1024 / 1024).toFixed(2),
      candidate: metaData.candidateName,
      company: metaData.company,
      role: metaData.role,
    });

    // Upload to Vercel Blob (public URL for easy download)
    const result = await put(fileName, buffer, { access: 'public', contentType, token });

    console.log('✅ INTERVIEW UPLOADED:', {
      fileName: result.pathname,
      url: result.url,
      sizeMB: +(buffer.length / 1024 / 1024).toFixed(2),
      candidate: metaData.candidateName,
      company: metaData.company,
      role: metaData.role,
      answered: metaData.answeredQuestions,
      total: metaData.totalQuestions,
      timestamp: metaData.timestamp,
    });

    return res.status(200).json({ 
      success: true, 
      url: result.url, 
      downloadUrl: result.url, 
      fileName: result.pathname 
    });
  } catch (e) {
    console.error('❌ Store error:', e);
    return res.status(500).json({ 
      error: 'Failed to store interview',
      details: e.message 
    });
  }
}
