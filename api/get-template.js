export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  
  if (!id) {
    return res.status(400).json({ error: 'Template ID required' });
  }

  try {
    const templateUrl = `https://a1okumvv8ctsq8zy.public.blob.vercel-storage.com/templates/${id}.json`;
    
    const response = await fetch(templateUrl);
    
    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: 'Template not found' });
      }
      throw new Error(`HTTP ${response.status}`);
    }
    
    const template = await response.json();
    
    return res.status(200).json(template);
    
  } catch (error) {
    console.error('Template fetch error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch template',
      details: error.message 
    });
  }
}
