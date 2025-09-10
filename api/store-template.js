import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const template = req.body;
    
    if (!template || !template.id) {
      return res.status(400).json({ error: 'Invalid template data' });
    }

    const templateData = JSON.stringify(template);
    const fileName = `templates/${template.id}.json`;
    
    const blob = await put(fileName, templateData, {
      access: 'public',
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN
    });

    return res.status(200).json({ 
      success: true, 
      templateId: template.id,
      url: blob.url 
    });
    
  } catch (error) {
    console.error('Template storage error:', error);
    return res.status(500).json({ 
      error: 'Failed to store template',
      details: error.message 
    });
  }
}
