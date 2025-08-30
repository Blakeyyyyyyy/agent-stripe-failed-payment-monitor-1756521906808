const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');

const app = express();
app.use(express.json());

// Gmail setup
const oauth2Client = new google.auth.OAuth2();
oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// In-memory logs for debugging
let logs = [];

function addLog(message) {
  const timestamp = new Date().toISOString();
  logs.push(`[${timestamp}] ${message}`);
  console.log(`[${timestamp}] ${message}`);
  // Keep only last 50 logs
  if (logs.length > 50) logs = logs.slice(-50);
}

// Send Gmail notification
async function sendFailureNotification(charge) {
  try {
    const customerInfo = charge.billing_details?.email || 
                        charge.customer || 
                        charge.billing_details?.name || 
                        'Unknown Customer';
    
    const failureTime = new Date(charge.created * 1000).toLocaleString();
    const amount = (charge.amount / 100).toFixed(2);
    const currency = charge.currency.toUpperCase();
    
    const subject = `⚠️ Stripe Payment Failed - ${customerInfo}`;
    const body = `
Payment Failure Alert

Customer: ${customerInfo}
Amount: ${amount} ${currency}
Date & Time: ${failureTime}
Failure Reason: ${charge.outcome?.seller_message || charge.failure_message || 'Not specified'}

Charge ID: ${charge.id}

This is an automated alert from your Stripe payment monitor.
    `;

    const message = [
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      `To: blakeecom02@gmail.com`,
      `Subject: ${subject}`,
      '',
      body
    ].join('\n');

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      resource: {
        raw: encodedMessage
      }
    });

    addLog(`✅ Failure notification sent for customer: ${customerInfo}`);
    return true;
  } catch (error) {
    addLog(`❌ Failed to send notification: ${error.message}`);
    return false;
  }
}

// Webhook endpoint for Stripe events
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    
    addLog(`📨 Received webhook: ${event.type}`);

    if (event.type === 'charge.failed') {
      const charge = event.data.object;
      addLog(`💳 Processing failed charge: ${charge.id}`);
      
      await sendFailureNotification(charge);
    }

    res.json({ received: true });
  } catch (error) {
    addLog(`❌ Webhook error: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// Standard endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'active',
    service: 'Stripe Failed Payment Monitor',
    endpoints: [
      'GET / - Service status',
      'GET /health - Health check',
      'GET /logs - View recent logs', 
      'POST /test - Test notification',
      'POST /webhook - Stripe webhook endpoint'
    ],
    monitoring: 'blakeecom02@gmail.com'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/logs', (req, res) => {
  res.json({ 
    logs: logs.slice(-20),
    total: logs.length 
  });
});

app.post('/test', async (req, res) => {
  try {
    addLog('🧪 Manual test triggered');
    
    // Create a test charge object
    const testCharge = {
      id: 'ch_test_' + Date.now(),
      amount: 2500, // $25.00
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      billing_details: {
        email: 'test@example.com',
        name: 'Test Customer'
      },
      failure_message: 'Your card was declined.',
      outcome: {
        seller_message: 'The bank declined the payment.'
      }
    };

    const success = await sendFailureNotification(testCharge);
    
    res.json({ 
      success,
      message: success ? 
        'Test notification sent to blakeecom02@gmail.com' : 
        'Failed to send test notification'
    });
  } catch (error) {
    addLog(`❌ Test error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  addLog(`🚀 Stripe payment monitor started on port ${PORT}`);
});

module.exports = app;