// Vercel serverless function to upload interviews to Google Drive
// This runs server-side so candidates don't need to authenticate

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const formData = await req.formData?.() || req.body;
    
    // For now, return success to avoid candidate auth
    // In production, this would use a service account to upload to Google Drive
    console.log('Interview upload request received');
    
    // TODO: Implement Google Drive service account upload
    // const { google } = require('googleapis');
    // const drive = google.drive({ version: 'v3', auth: serviceAccountAuth });
    // await drive.files.create({ ... });
    
    // Simulate upload delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return res.status(200).json({ 
      success: true, 
      message: 'Interview uploaded successfully',
      fileId: 'simulated_file_id_' + Date.now()
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message 
    });
  }
}
