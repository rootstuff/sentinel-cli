const axios = require('axios');
const { requireAuth, getApiUrl } = require('../utils/auth');

/**
 * Flatten a Laravel validation error bag ({ field: [messages] }) into lines.
 */
function formatValidationErrors(errors) {
  if (!errors || typeof errors !== 'object') return '';

  return Object.entries(errors)
    .map(([field, messages]) => `  ${field}: ${[].concat(messages).join(' ')}`)
    .join('\n');
}

class ApiClient {
  constructor(options = {}) {
    this.options = options;
    const apiUrl = getApiUrl(options).replace(/\/+$/, '');

    this.client = axios.create({
      // Every third-party endpoint lives under the versioned prefix.
      baseURL: `${apiUrl}/api/v1`,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      // Allow self-signed certificates in development
      httpsAgent: apiUrl.includes('localhost') || apiUrl.includes('.test')
        ? new (require('https').Agent)({ rejectUnauthorized: false })
        : undefined
    });

    // Add request interceptor for authentication
    this.client.interceptors.request.use(
      (config) => {
        const { token } = requireAuth(this.options);
        config.headers.Authorization = `Bearer ${token}`;
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          // The server answered with a non-2xx status. Surface the message the
          // API sent, plus the validation error bag when there is one.
          const { status, data } = error.response;
          let message = data?.message || data?.error || error.message;
          const details = formatValidationErrors(data?.errors);

          if (details) {
            message += `\n${details}`;
          }

          const apiError = new Error(`API Error (${status}): ${message}`);
          apiError.status = status;
          apiError.data = data;
          throw apiError;
        } else if (error.request) {
          // The request was made but no response was received
          throw new Error('No response from API server. Please check your connection and API URL.');
        } else {
          // Something happened in setting up the request that triggered an Error
          throw error;
        }
      }
    );
  }

  // Auth endpoints
  async testAuth() {
    const response = await this.client.get('/test');
    return response.data;
  }

  /**
   * The v1 root describes the caller: user, current team, and API version.
   */
  async getCurrentUser() {
    const response = await this.client.get('');
    return response.data;
  }

  // Teams endpoints
  async listTeams() {
    const response = await this.client.get('/teams');
    return response.data;
  }

  async switchTeam(teamId) {
    const response = await this.client.post(`/teams/${teamId}/switch`);
    return response.data;
  }

  // On-demand global check
  async checkUrl(params) {
    const response = await this.client.get('/check-url', { params });
    return response.data;
  }

  // Monitor endpoints
  async listMonitors(params = {}) {
    const response = await this.client.get('/monitors', { params });
    return response.data;
  }

  async getMonitor(id) {
    const response = await this.client.get(`/monitors/${id}`);
    return response.data;
  }

  async createMonitor(data) {
    const response = await this.client.post('/monitors', data);
    return response.data;
  }

  async updateMonitor(id, data) {
    const response = await this.client.put(`/monitors/${id}`, data);
    return response.data;
  }

  async deleteMonitor(id) {
    const response = await this.client.delete(`/monitors/${id}`);
    return response.data;
  }

  async checkMonitor(id) {
    const response = await this.client.post(`/monitors/${id}/check`);
    return response.data;
  }

  async pauseMonitor(id) {
    const response = await this.client.post(`/monitors/${id}/pause`);
    return response.data;
  }

  async unpauseMonitor(id) {
    const response = await this.client.post(`/monitors/${id}/unpause`);
    return response.data;
  }

  // Monitor group endpoints
  async listGroups() {
    const response = await this.client.get('/groups');
    return response.data;
  }

  async getGroup(id) {
    const response = await this.client.get(`/groups/${id}`);
    return response.data;
  }

  async createGroup(data) {
    const response = await this.client.post('/groups', data);
    return response.data;
  }

  async updateGroup(id, data) {
    const response = await this.client.put(`/groups/${id}`, data);
    return response.data;
  }

  async deleteGroup(id) {
    const response = await this.client.delete(`/groups/${id}`);
    return response.data;
  }

  // Incident endpoints
  async listIncidents(params = {}) {
    const response = await this.client.get('/incidents', { params });
    return response.data;
  }

  async getIncident(id) {
    const response = await this.client.get(`/incidents/${id}`);
    return response.data;
  }

  async createIncident(data) {
    const response = await this.client.post('/incidents', data);
    return response.data;
  }

  async updateIncident(id, data) {
    const response = await this.client.put(`/incidents/${id}`, data);
    return response.data;
  }

  async resolveIncident(id) {
    const response = await this.client.post(`/incidents/${id}/resolve`);
    return response.data;
  }

  async getMonitorIncidents(monitorId, params = {}) {
    const response = await this.client.get(`/monitors/${monitorId}/incidents`, { params });
    return response.data;
  }

  async acknowledgeIncident(id) {
    const response = await this.client.post(`/incidents/${id}/acknowledge`);
    return response.data;
  }

  async deleteIncident(id) {
    const response = await this.client.delete(`/incidents/${id}`);
    return response.data;
  }

  // Team member endpoints
  async listUsers() {
    const response = await this.client.get('/users');
    return response.data;
  }

  async updateUserRole(memberId, role) {
    const response = await this.client.put(`/users/${memberId}`, { role });
    return response.data;
  }

  async removeUser(memberId) {
    const response = await this.client.delete(`/users/${memberId}`);
    return response.data;
  }

  async listInvitations() {
    const response = await this.client.get('/users/invitations');
    return response.data;
  }

  async inviteUser(data) {
    const response = await this.client.post('/users/invitations', data);
    return response.data;
  }

  async updateInvitationRole(invitationId, role) {
    const response = await this.client.put(`/users/invitations/${invitationId}`, { role });
    return response.data;
  }

  async cancelInvitation(invitationId) {
    const response = await this.client.delete(`/users/invitations/${invitationId}`);
    return response.data;
  }

  // Webhook endpoint endpoints
  async listWebhookEndpoints() {
    const response = await this.client.get('/webhook-endpoints');
    return response.data;
  }

  async getWebhookEndpoint(id) {
    const response = await this.client.get(`/webhook-endpoints/${id}`);
    return response.data;
  }

  async createWebhookEndpoint(data) {
    const response = await this.client.post('/webhook-endpoints', data);
    return response.data;
  }

  async updateWebhookEndpoint(id, data) {
    const response = await this.client.put(`/webhook-endpoints/${id}`, data);
    return response.data;
  }

  async deleteWebhookEndpoint(id) {
    const response = await this.client.delete(`/webhook-endpoints/${id}`);
    return response.data;
  }

  async testWebhookEndpoint(id) {
    const response = await this.client.post(`/webhook-endpoints/${id}/test`);
    return response.data;
  }

  // Status Pages endpoints
  async listStatusPages(params = {}) {
    const response = await this.client.get('/status-pages', { params });
    return response.data;
  }

  async getStatusPage(id) {
    const response = await this.client.get(`/status-pages/${id}`);
    return response.data;
  }

  async createStatusPage(data) {
    const response = await this.client.post('/status-pages', data);
    return response.data;
  }

  async updateStatusPage(id, data) {
    const response = await this.client.put(`/status-pages/${id}`, data);
    return response.data;
  }

  async deleteStatusPage(id) {
    const response = await this.client.delete(`/status-pages/${id}`);
    return response.data;
  }

  // Notification Channels endpoints
  async listNotificationChannels() {
    const response = await this.client.get('/notification-channels');
    return response.data;
  }

  async getNotificationChannel(channel) {
    const response = await this.client.get(`/notification-channels/${channel}`);
    return response.data;
  }

  async createNotificationChannel(data) {
    const response = await this.client.post('/notification-channels', data);
    return response.data;
  }

  async updateNotificationChannel(channel, data) {
    const response = await this.client.put(`/notification-channels/${channel}`, data);
    return response.data;
  }

  async deleteNotificationChannel(channel) {
    const response = await this.client.delete(`/notification-channels/${channel}`);
    return response.data;
  }

  async testNotificationChannel(channel) {
    const response = await this.client.post(`/notification-channels/${channel}/test`);
    return response.data;
  }

  // Operator endpoints (super admin token with the `admin` ability)
  async adminCadence(params = {}) {
    const response = await this.client.get('/admin/cadence', { params });
    return response.data;
  }

  async adminIncidents(params = {}) {
    const response = await this.client.get('/admin/incidents', { params });
    return response.data;
  }

  async adminFreshness() {
    const response = await this.client.get('/admin/freshness');
    return response.data;
  }

  async adminApiErrors(params = {}) {
    const response = await this.client.get('/admin/api-errors', { params });
    return response.data;
  }

  async adminAbuse(params = {}) {
    const response = await this.client.get('/admin/abuse', { params });
    return response.data;
  }

  async adminFailedJobs(params = {}) {
    const response = await this.client.get('/admin/failed-jobs', { params });
    return response.data;
  }
}

module.exports = ApiClient;
