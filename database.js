const { kv } = require('@vercel/kv');

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
  async getSettings() {
    try {
      const settings = await kv.get('settings');
      return settings || defaultSettings;
    } catch (error) {
      console.error('Error reading settings:', error);
      return defaultSettings;
    }
  },
  async saveSettings(settings) {
    try {
      const current = await this.getSettings();
      const updated = { ...current, ...settings };
      await kv.set('settings', updated);
      return updated;
    } catch (error) {
      console.error('Error saving settings:', error);
      throw error;
    }
  },

  // Influencers
  async getInfluencers() {
    try {
      const influencers = await kv.get('influencers');
      return influencers || [];
    } catch (error) {
      console.error('Error reading influencers:', error);
      return [];
    }
  },
  async saveInfluencers(influencers) {
    try {
      await kv.set('influencers', influencers);
    } catch (error) {
      console.error('Error saving influencers:', error);
      throw error;
    }
  },
  async addInfluencer(influencer) {
    try {
      const list = await this.getInfluencers();
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
      await this.saveInfluencers(list);
      return newInfluencer;
    } catch (error) {
      console.error('Error adding influencer:', error);
      throw error;
    }
  },
  async updateInfluencerStatus(id, status) {
    try {
      const list = await this.getInfluencers();
      const idx = list.findIndex(i => i.id === id);
      if (idx !== -1) {
        list[idx].status = status;
        await this.saveInfluencers(list);
      }
    } catch (error) {
      console.error('Error updating influencer status:', error);
      throw error;
    }
  },

  // Campaigns
  async getCampaigns() {
    try {
      const campaigns = await kv.get('campaigns');
      return campaigns || [];
    } catch (error) {
      console.error('Error reading campaigns:', error);
      return [];
    }
  },
  async saveCampaigns(campaigns) {
    try {
      await kv.set('campaigns', campaigns);
    } catch (error) {
      console.error('Error saving campaigns:', error);
      throw error;
    }
  },
  async createCampaign(campaign) {
    try {
      const campaigns = await this.getCampaigns();
      const newCampaign = {
        id: 'camp_' + Date.now(),
        name: campaign.name || 'Unnamed Campaign',
        subjectTemplate: campaign.subjectTemplate || 'Collaboration inquiry for {{Name}}',
        bodyTemplate: campaign.bodyTemplate || 'Hi {{Name}},\n\nLove your content in the {{Niche}} space on {{Platform}}!\n\nWe would love to collaborate. Let me know if you are interested.\n\nBest regards',
        status: 'draft', // draft, active, paused, completed
        createdAt: new Date().toISOString(),
        sentCount: 0,
        failedCount: 0,
        totalCount: 0
      };
      campaigns.push(newCampaign);
      await this.saveCampaigns(campaigns);
      return newCampaign;
    } catch (error) {
      console.error('Error creating campaign:', error);
      throw error;
    }
  },

  // Queue
  async getQueue() {
    try {
      const queue = await kv.get('queue');
      return queue || [];
    } catch (error) {
      console.error('Error reading queue:', error);
      return [];
    }
  },
  async saveQueue(queue) {
    try {
      await kv.set('queue', queue);
    } catch (error) {
      console.error('Error saving queue:', error);
      throw error;
    }
  },
  async addToQueue(item) {
    try {
      const queue = await this.getQueue();
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
      await this.saveQueue(queue);
      return queueItem;
    } catch (error) {
      console.error('Error adding to queue:', error);
      throw error;
    }
  },

  // Logs / Sent History
  async getLogs() {
    try {
      const logs = await kv.get('logs');
      return logs || [];
    } catch (error) {
      console.error('Error reading logs:', error);
      return [];
    }
  },
  async saveLogs(logs) {
    try {
      await kv.set('logs', logs);
    } catch (error) {
      console.error('Error saving logs:', error);
      throw error;
    }
  },
  async addLog(log) {
    try {
      const logs = await this.getLogs();
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
      await this.saveLogs(logs);
      return newLog;
    } catch (error) {
      console.error('Error adding log:', error);
      throw error;
    }
  }
};

module.exports = db;
