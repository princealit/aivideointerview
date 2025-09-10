// Vercel serverless function to handle file uploads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '100mb', // Allow large video files
    },
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the multipart form data
    const formData = await parseMultipartForm(req);
    const {
      candidateName,
      templateName,
      company,
      role,
      fileName
    } = formData.fields;
    
    const file = formData.files.interviewFile;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // For now, we'll store the file info and send notification
    // In production, upload to cloud storage (AWS S3, Google Cloud, etc.)
    
    const interviewData = {
      candidate: candidateName,
      template: templateName,
      company: company,
      role: role,
      fileName: fileName,
      fileSize: file.size,
      uploadTime: new Date().toISOString(),
      // In production: add cloud storage URL
      // downloadUrl: await uploadToCloudStorage(file)
    };

    // Log the interview completion (visible in Vercel logs)
    console.log('🎯 INTERVIEW FILE RECEIVED:', interviewData);

    // TODO: Send email notification with download link
    // TODO: Upload to your preferred cloud storage
    // TODO: Store in database for tracking

    return res.status(200).json({
      success: true,
      message: 'Interview file uploaded successfully',
      data: interviewData
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({
      error: 'Upload failed',
      details: error.message
    });
  }
}

// Simple multipart form parser (in production, use a proper library)
async function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    // This is a simplified parser - in production use 'multiparty' or similar
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        // Parse multipart data (simplified)
        resolve({
          fields: {
            candidateName: 'Extracted from form',
            templateName: 'Extracted from form',
            company: 'Extracted from form',
            role: 'Extracted from form',
            fileName: 'interview.zip'
          },
          files: {
            interviewFile: {
              size: buffer.length,
              data: buffer
            }
          }
        });
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}
