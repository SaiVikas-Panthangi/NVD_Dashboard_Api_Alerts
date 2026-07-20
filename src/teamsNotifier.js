async function sendTeamsNotification(webhookUrl, message) {
  if (!webhookUrl) {
    return {
      sent: false,
      skipped: true,
      reason: 'teamsWebhookUrl is empty'
    };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: message })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        sent: false,
        skipped: false,
        reason: `Teams webhook returned HTTP ${response.status}${body ? ` - ${body}` : ''}`
      };
    }

    return {
      sent: true,
      skipped: false,
      reason: null
    };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      reason: error && error.message ? error.message : String(error)
    };
  }
}

module.exports = {
  sendTeamsNotification
};
