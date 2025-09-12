import { put } from '@vercel/blob';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  console.log('📥 Store interview request received:', {
    method: req.method,
    headers: Object.keys(req.headers),
    contentLength: req.headers['content-length']
  });

  if (req.method !== 'POST') {
    console.error('❌ Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Ensure token exists first
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      console.error('❌ Missing BLOB_READ_WRITE_TOKEN environment variable');
      return res.status(500).json({ error: 'Storage token not configured' });
    }

    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
      console.log('📦 Received chunk:', chunk.length, 'bytes');
    });
    
    await new Promise((resolve) => req.on('end', resolve));

    const buffer = Buffer.concat(chunks);
    console.log('📊 Total buffer size:', buffer.length, 'bytes');

    if (buffer.length === 0) {
      console.error('❌ Empty buffer received');
      return res.status(400).json({ error: 'No data received' });
    }

    const baseName = req.headers['x-filename'] || `interview_${Date.now()}.zip`;
    const fileName = baseName.startsWith('interviews/') ? baseName : `interviews/${baseName}`;
    const contentType = req.headers['content-type'] || 'application/zip';
    
    let metaData = {};
    try {
      metaData = JSON.parse(req.headers['x-meta'] || '{}');
    } catch (parseError) {
      console.warn('⚠️ Failed to parse metadata:', parseError);
      metaData = {};
    }

    console.log('📤 Uploading interview:', {
      fileName,
      sizeMB: +(buffer.length / 1024 / 1024).toFixed(2),
      candidate: metaData.candidateName,
      company: metaData.company,
      role: metaData.role,
    });

    // Upload to Vercel Blob (public URL for easy download)
    console.log('🚀 Starting Vercel Blob upload...');
    const result = await put(fileName, buffer, { 
      access: 'public', 
      contentType,
      token 
    });
    console.log('✅ Vercel Blob upload completed:', result.pathname);

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
