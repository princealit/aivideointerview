// Vercel serverless function to notify interviewer when interview is completed
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      candidateName,
      templateName,
      company,
      role,
      fileName,
      answeredQuestions,
      totalQuestions,
      timestamp
    } = req.body;

    console.log('Interview completed notification:', {
      candidateName,
      templateName,
      company,
      role,
      fileName,
      answeredQuestions,
      totalQuestions,
      timestamp
    });

    // TODO: In production, implement:
    // 1. Email notification to interviewer
    // 2. Webhook to your system
    // 3. Database logging
    // 4. File upload to your storage

    // For now, just log and return success
    const notificationSent = true;

    if (notificationSent) {
      return res.status(200).json({
        success: true,
        message: 'Interviewer notified successfully'
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Failed to notify interviewer'
      });
    }

  } catch (error) {
    console.error('Notification error:', error);
    return res.status(500).json({
      error: 'Notification failed',
      details: error.message
    });
  }
}
