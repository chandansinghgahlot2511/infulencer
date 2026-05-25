const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const path = require('path');
const db = require('./database');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Queue Processor State
let queueIntervalId = null;
let isProcessing = false;
let emailsSentToday = 0;
let lastResetDate = new Date().toDateString();

// Helper to get NodeMailer Transporter
function getTransporter(settings) {
  if (settings.sandboxMode) {
    return null;
  }
  return nodemailer.createTransport({
    host: settings.smtpHost || process.env.SMTP_HOST,
    port: parseInt(settings.smtpPort || process.env.SMTP_PORT || '587'),
    secure: settings.smtpSecure === 'true' || settings.smtpSecure === true,
    auth: {
      user: settings.smtpUser || process.env.SMTP_USER,
      pass: settings.smtpPass || process.env.SMTP_PASS
    }
  });
}

// Check and reset daily counter if calendar day changed
function checkDailyReset(settings) {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    emailsSentToday = 0;
    lastResetDate = today;
    db.addLog({
      type: 'info',
      message: 'Daily email counter reset to 0.'
    });
  }
}

// Custom Rule-Based Personalization Fallback
function applyRuleBasedPersonalization(template, influencer) {
  let content = template;
  
  // Custom opening hook based on niche and platform
  let hook = '';
  if (influencer.niche && influencer.platform) {
    const platform = influencer.platform.toLowerCase();
    const niche = influencer.niche.toLowerCase();
    
    if (platform.includes('instagram')) {
      hook = `I came across your Instagram profile and was really impressed by your posts in the ${niche} space!`;
    } else if (platform.includes('youtube')) {
      hook = `I was watching some of your YouTube videos on ${niche} and love the way you engage with your viewers.`;
    } else if (platform.includes('tiktok')) {
      hook = `Your TikTok videos in the ${niche} niche are incredibly engaging and creative.`;
    } else if (platform.includes('twitter') || platform.includes('x')) {
      hook = `I saw your posts on X/Twitter and love your insights in the ${niche} space!`;
    } else if (platform.includes('snapchat')) {
      hook = `I came across your Snapchat stories and really enjoy your ${niche} content!`;
    } else if (platform.includes('linkedin')) {
      hook = `I visited your LinkedIn profile and was highly impressed by your professional background in ${niche}!`;
    } else if (platform.includes('pinterest')) {
      hook = `I was browsing your Pinterest boards and love your creative pins in the ${niche} category!`;
    } else if (platform.includes('web') || platform.includes('blog') || platform.includes('website')) {
      hook = `I was reading your website articles about ${niche} and found your insights incredibly valuable!`;
    } else if (platform.includes('lead') || platform.includes('general')) {
      hook = `I've been following your work in the ${niche} industry and wanted to reach out to connect!`;
    } else {
      hook = `I've been following your ${niche} content and really appreciate your unique perspective.`;
    }
  } else {
    hook = `I wanted to reach out because I really admire the content you share.`;
  }

  // Follower-specific comment
  let followerNote = '';
  if (influencer.followers) {
    followerNote = `It's awesome to see the community of ${influencer.followers} followers you've built.`;
  }

  // Retrieve current settings for Brand variable substitutions
  const settings = db.getSettings();

  // Replace placeholders
  content = content.replace(/\{\{Name\}\}/gi, influencer.name || 'there');
  content = content.replace(/\{\{Niche\}\}/gi, influencer.niche || 'content creation');
  content = content.replace(/\{\{Platform\}\}/gi, influencer.platform || 'social media');
  content = content.replace(/\{\{Followers\}\}/gi, influencer.followers || 'your community');
  content = content.replace(/\{\{Engagement\}\}/gi, influencer.engagement || 'great engagement');
  content = content.replace(/\{\{Bio\}\}/gi, influencer.notes || '');
  content = content.replace(/\{\{Notes\}\}/gi, influencer.notes || '');
  content = content.replace(/\{\{OpeningHook\}\}/gi, hook);
  content = content.replace(/\{\{FollowerNote\}\}/gi, followerNote);
  
  // Brand Variables
  content = content.replace(/\{\{BrandX\}\}/gi, settings.brandX || '');
  content = content.replace(/\{\{BrandSnapchat\}\}/gi, settings.brandSnapchat || '');
  content = content.replace(/\{\{BrandInstagram\}\}/gi, settings.brandInstagram || '');
  content = content.replace(/\{\{BrandWebsite\}\}/gi, settings.brandWebsite || '');

  return content;
}

// AI Personalization with Gemini API
async function applyAIPersonalization(template, influencer, settings) {
  const apiKey = process.env.GEMINI_API_KEY || settings.geminiApiKey;
  if (!apiKey) {
    return applyRuleBasedPersonalization(template, influencer);
  }

  const prompt = `
    You are an expert influencer marketing manager. You need to write a highly personalized email based on this email template and influencer profile.
    
    Email Template:
    """
    ${template}
    """
    
    Influencer Profile:
    - Name: ${influencer.name}
    - Platform: ${influencer.platform}
    - Niche: ${influencer.niche}
    - Follower Count: ${influencer.followers}
    - Bio/Notes: ${influencer.notes}
    
    Instructions:
    - Keep the core offer/intent of the template, but rewrite the sentences to flow naturally and sound like a genuine, high-quality human outreach email.
    - Personalize the email using their name, platform, niche, and details from their bio.
    - Do NOT make up false details that are not in their profile.
    - DO NOT write email subject lines in your output, just the body content.
    - System Prompt Context: ${settings.aiSystemPrompt}
    
    Return ONLY the personalized email body text, with no extra code blocks, markdown tags, or headers.
  `;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    
    const data = await response.json();
    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
      return data.candidates[0].content.parts[0].text.trim();
    } else {
      console.warn('Gemini API response structure unexpected, falling back to rule-based.');
      return applyRuleBasedPersonalization(template, influencer);
    }
  } catch (error) {
    console.error('Gemini API request failed, falling back to rule-based:', error);
    return applyRuleBasedPersonalization(template, influencer);
  }
}

// Background Queue Worker
async function processQueueStep() {
  if (isProcessing) return;
  isProcessing = true;

  const settings = db.getSettings();
  checkDailyReset(settings);

  // Check if daily limit reached
  if (emailsSentToday >= settings.emailsPerDayLimit) {
    db.addLog({
      type: 'warning',
      message: `Daily sending limit of ${settings.emailsPerDayLimit} emails reached. Pausing queue.`
    });
    stopQueueProcessor();
    isProcessing = false;
    return;
  }

  const queue = db.getQueue();
  const pendingItems = queue.filter(item => item.status === 'pending');

  if (pendingItems.length === 0) {
    // Check if any campaigns should be completed
    const campaigns = db.getCampaigns();
    let updatedCampaign = false;
    campaigns.forEach(campaign => {
      if (campaign.status === 'active') {
        const campQueue = queue.filter(q => q.campaignId === campaign.id);
        const campPending = campQueue.filter(q => q.status === 'pending' || q.status === 'sending');
        if (campQueue.length > 0 && campPending.length === 0) {
          campaign.status = 'completed';
          updatedCampaign = true;
          db.addLog({
            type: 'info',
            message: `Campaign "${campaign.name}" completed successfully.`
          });
        }
      }
    });
    if (updatedCampaign) {
      db.saveCampaigns(campaigns);
    }
    
    stopQueueProcessor();
    isProcessing = false;
    return;
  }

  // Sort queue by scheduled time
  const now = new Date();
  const nextItem = pendingItems
    .filter(item => new Date(item.scheduledTime) <= now)
    .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime))[0];

  if (!nextItem) {
    // No item scheduled for now yet
    isProcessing = false;
    return;
  }

  // Start sending nextItem
  nextItem.status = 'sending';
  db.saveQueue(queue);

  const influencerList = db.getInfluencers();
  const influencer = influencerList.find(i => i.id === nextItem.influencerId);
  const campaigns = db.getCampaigns();
  const campaign = campaigns.find(c => c.id === nextItem.campaignId);

  if (!influencer || !campaign) {
    nextItem.status = 'failed';
    nextItem.error = 'Influencer or Campaign no longer exists';
    db.saveQueue(queue);
    isProcessing = false;
    return;
  }

  // Update influencer status to sending
  db.updateInfluencerStatus(influencer.id, 'sending');

  try {
    let finalBody = nextItem.personalizedBody;
    // If not generated yet (or needs update), personalize now
    if (!finalBody) {
      if (settings.aiPersonalizationEnabled) {
        finalBody = await applyAIPersonalization(campaign.bodyTemplate, influencer, settings);
      } else {
        finalBody = applyRuleBasedPersonalization(campaign.bodyTemplate, influencer);
      }
      nextItem.personalizedBody = finalBody;
    }
    
    let finalSubject = nextItem.personalizedSubject;
    if (!finalSubject) {
      finalSubject = applyRuleBasedPersonalization(campaign.subjectTemplate, influencer);
      nextItem.personalizedSubject = finalSubject;
    }

    if (settings.sandboxMode) {
      // Simulate successful send
      setTimeout(() => {
        nextItem.status = 'sent';
        nextItem.sentTime = new Date().toISOString();
        db.saveQueue(queue);

        db.updateInfluencerStatus(influencer.id, 'sent');
        
        // Update campaign counters
        campaign.sentCount += 1;
        db.saveCampaigns(campaigns);

        emailsSentToday += 1;
        
        db.addLog({
          type: 'success',
          message: `[SANDBOX] Email successfully simulated to ${influencer.name} (${influencer.email}) for Campaign: "${campaign.name}"`
        });
        
        isProcessing = false;
      }, 500);
    } else {
      // Real email send
      const transporter = getTransporter(settings);
      if (!transporter) {
        throw new Error('SMTP credentials not configured or transporter creation failed.');
      }

      const mailOptions = {
        from: settings.smtpFrom || process.env.SMTP_FROM,
        to: influencer.email,
        subject: finalSubject,
        text: finalBody
      };

      const info = await transporter.sendMail(mailOptions);
      
      nextItem.status = 'sent';
      nextItem.sentTime = new Date().toISOString();
      db.saveQueue(queue);

      db.updateInfluencerStatus(influencer.id, 'sent');

      campaign.sentCount += 1;
      db.saveCampaigns(campaigns);

      emailsSentToday += 1;

      db.addLog({
        type: 'success',
        message: `Email sent to ${influencer.name} (${influencer.email}). MsgID: ${info.messageId}`
      });

      isProcessing = false;
    }
  } catch (err) {
    console.error('Failed to send email:', err);
    nextItem.status = 'failed';
    nextItem.error = err.message;
    db.saveQueue(queue);

    db.updateInfluencerStatus(influencer.id, 'failed');

    campaign.failedCount += 1;
    db.saveCampaigns(campaigns);

    db.addLog({
      type: 'error',
      message: `Failed sending to ${influencer.name} (${influencer.email}): ${err.message}`
    });

    isProcessing = false;
  }
}

// Start Background Queue Processor
function startQueueProcessor() {
  if (queueIntervalId) return;

  const settings = db.getSettings();
  // Average interval check (e.g. check every 3 seconds)
  queueIntervalId = setInterval(processQueueStep, 3000);
  
  db.addLog({
    type: 'info',
    message: 'Email Queue Worker started.'
  });
}

// Stop Queue Processor
function stopQueueProcessor() {
  if (queueIntervalId) {
    clearInterval(queueIntervalId);
    queueIntervalId = null;
    db.addLog({
      type: 'info',
      message: 'Email Queue Worker paused/stopped.'
    });
  }
}

// REST ENDPOINTS

// Settings
app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

app.post('/api/settings', (req, res) => {
  const updated = db.saveSettings(req.body);
  res.json(updated);
});

// Test Email Setup
app.post('/api/test-email', async (req, res) => {
  const { to, settings } = req.body;
  
  if (!to) {
    return res.status(400).json({ error: 'Recipient email is required' });
  }

  const activeSettings = { ...db.getSettings(), ...settings };
  
  if (activeSettings.sandboxMode) {
    return res.json({ 
      success: true, 
      message: '[SANDBOX] Test email generated and logged successfully (no network transmission).'
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: activeSettings.smtpHost,
      port: parseInt(activeSettings.smtpPort),
      secure: activeSettings.smtpSecure === 'true' || activeSettings.smtpSecure === true,
      auth: {
        user: activeSettings.smtpUser,
        pass: activeSettings.smtpPass
      }
    });

    const info = await transporter.sendMail({
      from: activeSettings.smtpFrom,
      to,
      subject: 'Influencer outreach agent - SMTP Connection Test',
      text: 'Congratulations! Your SMTP outreach connection has been verified successfully. Your agent is ready to send.'
    });

    res.json({ success: true, message: `Test email sent successfully. MsgID: ${info.messageId}` });
  } catch (error) {
    res.status(500).json({ error: `SMTP Connection test failed: ${error.message}` });
  }
});

// Influencers
app.get('/api/influencers', (req, res) => {
  res.json(db.getInfluencers());
});

app.post('/api/influencers', (req, res) => {
  const influencer = db.addInfluencer(req.body);
  res.status(201).json(influencer);
});

app.post('/api/influencers/import', (req, res) => {
  const items = req.body; // Array of influencers
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Body must be an array of influencers' });
  }
  
  const importedList = [];
  const currentList = db.getInfluencers();

  items.forEach(item => {
    // Avoid double adding exact emails in same session
    if (item.email) {
      const exists = currentList.some(i => i.email.toLowerCase() === item.email.toLowerCase());
      if (!exists) {
        const newInf = {
          id: 'inf_' + Date.now() + Math.random().toString(36).substring(2, 7),
          name: item.name || 'N/A',
          email: item.email,
          niche: item.niche || 'General',
          platform: item.platform || 'Instagram',
          followers: item.followers || '0',
          engagement: item.engagement || '0%',
          notes: item.notes || '',
          status: 'idle',
          createdAt: new Date().toISOString()
        };
        currentList.push(newInf);
        importedList.push(newInf);
      }
    }
  });

  db.saveInfluencers(currentList);
  db.addLog({
    type: 'success',
    message: `Imported ${importedList.length} new influencers successfully from list.`
  });
  
  res.json({ success: true, count: importedList.length, imported: importedList });
});

app.delete('/api/influencers', (req, res) => {
  db.saveInfluencers([]);
  res.json({ success: true, message: 'All influencers cleared.' });
});

app.delete('/api/influencers/:id', (req, res) => {
  const list = db.getInfluencers();
  const filtered = list.filter(i => i.id !== req.params.id);
  db.saveInfluencers(filtered);
  res.json({ success: true });
});

// Campaigns
app.get('/api/campaigns', (req, res) => {
  res.json(db.getCampaigns());
});

app.post('/api/campaigns', (req, res) => {
  const campaign = db.createCampaign(req.body);
  res.status(201).json(campaign);
});

// Start campaign (queue up emails for influencers matching criteria)
app.post('/api/campaigns/:id/start', async (req, res) => {
  const campaignId = req.params.id;
  const campaigns = db.getCampaigns();
  const campaign = campaigns.find(c => c.id === campaignId);

  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  if (campaign.status === 'active') {
    return res.json({ success: true, message: 'Campaign is already running.' });
  }

  // Get idle influencers
  const influencers = db.getInfluencers();
  const idleInfluencers = influencers.filter(i => i.status === 'idle' || i.status === 'failed');

  if (idleInfluencers.length === 0) {
    return res.status(400).json({ error: 'No idle or failed influencers available to queue.' });
  }

  const settings = db.getSettings();
  campaign.status = 'active';
  campaign.totalCount = campaign.sentCount + idleInfluencers.length;
  db.saveCampaigns(campaigns);

  // Queue up emails with scheduled times staggered
  const now = new Date();
  let schedulePointer = new Date(now.getTime() + 1000); // Start 1s from now

  for (let idx = 0; idx < idleInfluencers.length; idx++) {
    const inf = idleInfluencers[idx];
    
    // Personalize content
    let subject = applyRuleBasedPersonalization(campaign.subjectTemplate, inf);
    let body = '';
    
    // Pre-generate rule-based personalization. If AI is enabled, worker generates it when processing to avoid UI lag.
    if (!settings.aiPersonalizationEnabled) {
      body = applyRuleBasedPersonalization(campaign.bodyTemplate, inf);
    }

    db.addToQueue({
      influencerId: inf.id,
      campaignId: campaign.id,
      personalizedSubject: subject,
      personalizedBody: body, // empty means worker will compute it dynamically
      scheduledTime: schedulePointer.toISOString()
    });

    db.updateInfluencerStatus(inf.id, 'queued');

    // Stagger scheduling by random delay
    const delay = Math.floor(Math.random() * (settings.maxDelaySeconds - settings.minDelaySeconds + 1)) + settings.minDelaySeconds;
    schedulePointer = new Date(schedulePointer.getTime() + delay * 1000);
  }

  // Start background worker loop
  startQueueProcessor();

  db.addLog({
    type: 'info',
    message: `Campaign "${campaign.name}" activated. ${idleInfluencers.length} emails added to queue.`
  });

  res.json({ success: true, campaign });
});

// Pause Campaign
app.post('/api/campaigns/:id/pause', (req, res) => {
  const campaignId = req.params.id;
  const campaigns = db.getCampaigns();
  const campaign = campaigns.find(c => c.id === campaignId);

  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }

  campaign.status = 'paused';
  db.saveCampaigns(campaigns);

  // Remove pending queue items for this campaign, set influencers status back to idle
  const queue = db.getQueue();
  const queueItems = queue.filter(item => item.campaignId === campaignId && item.status === 'pending');
  
  queueItems.forEach(item => {
    item.status = 'failed';
    item.error = 'Campaign paused by user';
    db.updateInfluencerStatus(item.influencerId, 'idle');
  });
  db.saveQueue(queue);

  db.addLog({
    type: 'info',
    message: `Campaign "${campaign.name}" paused. Cleared ${queueItems.length} pending items from active dispatch.`
  });

  res.json({ success: true, campaign });
});

app.delete('/api/campaigns/:id', (req, res) => {
  const campaigns = db.getCampaigns();
  const filtered = campaigns.filter(c => c.id !== req.params.id);
  db.saveCampaigns(filtered);
  
  // Clean queue
  const queue = db.getQueue();
  const cleanQueue = queue.filter(q => q.campaignId !== req.params.id);
  db.saveQueue(cleanQueue);

  res.json({ success: true });
});

// Queue
app.get('/api/queue', (req, res) => {
  res.json(db.getQueue());
});

app.delete('/api/queue/clear', (req, res) => {
  db.saveQueue([]);
  // Reset influencers status
  const influencers = db.getInfluencers();
  influencers.forEach(i => {
    if (i.status === 'queued' || i.status === 'sending') {
      i.status = 'idle';
    }
  });
  db.saveInfluencers(influencers);

  // Mark active campaigns as paused
  const campaigns = db.getCampaigns();
  campaigns.forEach(c => {
    if (c.status === 'active') {
      c.status = 'paused';
    }
  });
  db.saveCampaigns(campaigns);

  stopQueueProcessor();

  db.addLog({
    type: 'info',
    message: 'Email Queue cleared by user.'
  });

  res.json({ success: true });
});

// Logs
app.get('/api/logs', (req, res) => {
  res.json(db.getLogs());
});

app.delete('/api/logs', (req, res) => {
  db.saveLogs([]);
  res.json({ success: true });
});

// Status of Worker
app.get('/api/status', (req, res) => {
  const queue = db.getQueue();
  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const sendingCount = queue.filter(q => q.status === 'sending').length;
  
  res.json({
    workerActive: queueIntervalId !== null,
    pendingEmails: pendingCount,
    sendingEmails: sendingCount,
    emailsSentToday,
    limit: db.getSettings().emailsPerDayLimit
  });
});

// Control Worker directly
app.post('/api/status/toggle', (req, res) => {
  if (queueIntervalId) {
    stopQueueProcessor();
  } else {
    startQueueProcessor();
  }
  res.json({ workerActive: queueIntervalId !== null });
});

// Serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Auto-start worker on load if active items exist
const pendingOnLoad = db.getQueue().filter(q => q.status === 'pending').length;
if (pendingOnLoad > 0) {
  startQueueProcessor();
}

app.listen(PORT, () => {
  console.log(`Influencer Outreach Email Agent listening on http://localhost:${PORT}`);
});