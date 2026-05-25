const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper to get filepath
function getFilePath(table) {
  return path.join(DATA_DIR, `${table}.json`);
}

// Atomically save data to JSON file
function saveFile(table, data) {
  const filePath = getFilePath(table);
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    console.error(`Error saving database table ${table}:`, error);
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    throw error;
  }
}

// Read data from JSON file
function readFile(table, defaultValue = []) {
  const filePath = getFilePath(table);
  if (!fs.existsSync(filePath)) {
    saveFile(table, defaultValue);
    return defaultValue;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading database table ${table}:`, error);
    return defaultValue;
  }
}

// Default states
const defaultSettings = {
  smtpHost: '',
  smtpPort: '587',
  smtpUser: '',
  smtpPass: '',
  smtpFrom: '',
  smtpSecure: false,
  sandboxMode: true, // Default to sandbox for safety
  emailsPerDayLimit: 1000,
  minDelaySeconds: 5,
  maxDelaySeconds: 15,
  aiPersonalizationEnabled: false,
  aiSystemPrompt: 'Draft a short, highly personalized and friendly email pitch to this influencer. Focus on collaboration for our brand. Avoid overly corporate jargon. Keep it under 150 words.',
  brandX: '',
  brandSnapchat: '',
  brandInstagram: '',
  brandWebsite: ''
};

const db = {
  // Settings
  getSettings() {
    return readFile('settings', defaultSettings);
  },
  saveSettings(settings) {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    saveFile('settings', updated);
    return updated;
  },

  // Influencers
  getInfluencers() {
    return readFile('influencers', []);
  },
  saveInfluencers(influencers) {
    saveFile('influencers', influencers);
  },
  addInfluencer(influencer) {
    const list = this.getInfluencers();
    const newInfluencer = {
      id: 'inf_' + Date.now() + Math.random().toString(36).substring(2, 7),
      name: influencer.name || 'N/A',
      email: influencer.email || '',
      niche: influencer.niche || 'General',
      platform: influencer.platform || 'Instagram',
      followers: influencer.followers || '0',
      engagement: influencer.engagement || '0%',
      notes: influencer.notes || '',
      status: 'idle', // idle, queued, sent, failed
      createdAt: new Date().toISOString()
    };
    list.push(newInfluencer);
    this.saveInfluencers(list);
    return newInfluencer;
  },
  updateInfluencerStatus(id, status) {
    const list = this.getInfluencers();
    const idx = list.findIndex(i => i.id === id);
    if (idx !== -1) {
      list[idx].status = status;
      this.saveInfluencers(list);
    }
  },

  // Campaigns
  getCampaigns() {
    return readFile('campaigns', []);
  },
  saveCampaigns(campaigns) {
    saveFile('campaigns', campaigns);
  },
  createCampaign(campaign) {
    const campaigns = this.getCampaigns();
    const newCampaign = {
      id: 'camp_' + Date.now(),
      name: campaign.name || 'Unnamed Campaign',
      subjectTemplate: campaign.subjectTemplate || 'Collaboration inquiry for {{Name}}',
      bodyTemplate: campaign.bodyTemplate || 'Hi {{Name}},\n\nLove your content in the {{Niche}} space on {{Platform}}!\n\nWe would love to collaborate. Let me know if you are interested.\n\nBest,\nTeam',
      status: 'draft', // draft, active, paused, completed
      createdAt: new Date().toISOString(),
      sentCount: 0,
      failedCount: 0,
      totalCount: 0
    };
    campaigns.push(newCampaign);
    this.saveCampaigns(campaigns);
    return newCampaign;
  },

  // Queue
  getQueue() {
    return readFile('queue', []);
  },
  saveQueue(queue) {
    saveFile('queue', queue);
  },
  addToQueue(item) {
    const queue = this.getQueue();
    const queueItem = {
      id: 'q_' + Date.now() + Math.random().toString(36).substring(2, 7),
      influencerId: item.influencerId,
      campaignId: item.campaignId,
      personalizedSubject: item.personalizedSubject,
      personalizedBody: item.personalizedBody,
      status: 'pending', // pending, sending, sent, failed
      error: null,
      createdTime: new Date().toISOString(),
      scheduledTime: item.scheduledTime || new Date().toISOString(),
      sentTime: null
    };
    queue.push(queueItem);
    this.saveQueue(queue);
    return queueItem;
  },

  // Logs / Sent History
  getLogs() {
    return readFile('logs', []);
  },
  saveLogs(logs) {
    saveFile('logs', logs);
  },
  addLog(log) {
    const logs = this.getLogs();
    const newLog = {
      id: 'log_' + Date.now() + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
      ...log
    };
    logs.push(newLog);
    // Keep logs size bounded to 5000 entries
    if (logs.length > 5000) {
      logs.shift();
    }
    this.saveLogs(logs);
    return newLog;
  }
};

module.exports = db;