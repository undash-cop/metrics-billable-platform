/**
 * Example API Client
 * 
 * Demonstrates how to interact with the billing platform APIs.
 * Can be used as a reference for building your own client.
 */

interface ClientConfig {
  baseUrl: string;
  adminApiKey?: string;
  projectApiKey?: string;
}

class BillingPlatformClient {
  private baseUrl: string;
  private adminApiKey?: string;
  private projectApiKey?: string;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.adminApiKey = config.adminApiKey;
    this.projectApiKey = config.projectApiKey;
  }

  /**
   * Ingest usage event
   */
  async ingestEvent(params: {
    eventId: string;
    metricName: string;
    metricValue: number;
    unit: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ event_id: string; status: string }> {
    if (!this.projectApiKey) {
      throw new Error('Project API key required for event ingestion');
    }

    const response = await fetch(`${this.baseUrl}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.projectApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_id: params.eventId,
        metric_name: params.metricName,
        metric_value: params.metricValue,
        unit: params.unit,
        timestamp: params.timestamp,
        metadata: params.metadata,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Event ingestion failed: ${error.error}`);
    }

    return await response.json();
  }

  /**
   * Create organisation
   */
  async createOrganisation(params: {
    name: string;
    billingEmail?: string;
    taxId?: string;
    razorpayCustomerId?: string;
  }): Promise<{
    id: string;
    name: string;
    createdAt: string;
  }> {
    if (!this.adminApiKey) {
      throw new Error('Admin API key required');
    }

    const response = await fetch(`${this.baseUrl}/api/v1/admin/organisations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.adminApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: params.name,
        billingEmail: params.billingEmail,
        taxId: params.taxId,
        razorpayCustomerId: params.razorpayCustomerId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create organisation: ${error.error}`);
    }

    return await response.json();
  }

  /**
   * Create project
   */
  async createProject(params: {
    organisationId: string;
    name: string;
    description?: string;
  }): Promise<{
    id: string;
    organisationId: string;
    name: string;
    apiKey: string;
  }> {
    if (!this.adminApiKey) {
      throw new Error('Admin API key required');
    }

    const response = await fetch(
      `${this.baseUrl}/api/v1/admin/organisations/${params.organisationId}/projects`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.adminApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: params.name,
          description: params.description,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create project: ${error.error}`);
    }

    return await response.json();
  }

  /**
   * Generate API key for project
   */
  async generateApiKey(projectId: string): Promise<{
    projectId: string;
    apiKey: string;
    message: string;
  }> {
    if (!this.adminApiKey) {
      throw new Error('Admin API key required');
    }

    const response = await fetch(
      `${this.baseUrl}/api/v1/admin/projects/${projectId}/api-keys`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.adminApiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to generate API key: ${error.error}`);
    }

    return await response.json();
  }

  /**
   * Get usage summary
   */
  async getUsageSummary(params: {
    organisationId: string;
    startMonth?: number;
    startYear?: number;
    endMonth?: number;
    endYear?: number;
    projectId?: string;
    metricName?: string;
  }): Promise<{
    organisationId: string;
    totalUsage: number;
    totalEvents: number;
    metrics: Array<{
      metricName: string;
      unit: string;
      totalUsage: number;
      totalEvents: number;
    }>;
  }> {
    if (!this.adminApiKey) {
      throw new Error('Admin API key required');
    }

    const queryParams = new URLSearchParams();
    if (params.startMonth) queryParams.set('startMonth', String(params.startMonth));
    if (params.startYear) queryParams.set('startYear', String(params.startYear));
    if (params.endMonth) queryParams.set('endMonth', String(params.endMonth));
    if (params.endYear) queryParams.set('endYear', String(params.endYear));
    if (params.projectId) queryParams.set('projectId', params.projectId);
    if (params.metricName) queryParams.set('metricName', params.metricName);

    const response = await fetch(
      `${this.baseUrl}/api/v1/admin/organisations/${params.organisationId}/usage?${queryParams}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.adminApiKey}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to get usage summary: ${error.error}`);
    }

    return await response.json();
  }

  /**
   * List invoices
   */
  async listInvoices(params: {
    organisationId: string;
    status?: string;
    startMonth?: number;
    startYear?: number;
    endMonth?: number;
    endYear?: number;
    limit?: number;
    offset?: number;
  }): Promise<{
    invoices: Array<{
      id: string;
      invoiceNumber: string;
      status: string;
      total: string;
      createdAt: string;
    }>;
    total: number;
  }> {
    if (!this.adminApiKey) {
      throw new Error('Admin API key required');
    }

    const queryParams = new URLSearchParams();
    if (params.status) queryParams.set('status', params.status);
    if (params.startMonth) queryParams.set('startMonth', String(params.startMonth));
    if (params.startYear) queryParams.set('startYear', String(params.startYear));
    if (params.endMonth) queryParams.set('endMonth', String(params.endMonth));
    if (params.endYear) queryParams.set('endYear', String(params.endYear));
    if (params.limit) queryParams.set('limit', String(params.limit));
    if (params.offset) queryParams.set('offset', String(params.offset));

    const response = await fetch(
      `${this.baseUrl}/api/v1/admin/organisations/${params.organisationId}/invoices?${queryParams}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.adminApiKey}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to list invoices: ${error.error}`);
    }

    return await response.json();
  }

  /**
   * Get invoice details
   */
  async getInvoice(invoiceId: string): Promise<{
    id: string;
    invoiceNumber: string;
    status: string;
    total: string;
    lineItems: Array<{
      lineNumber: number;
      description: string;
      quantity: string;
      unitPrice: string;
      total: string;
    }>;
  }> {
    if (!this.adminApiKey) {
      throw new Error('Admin API key required');
    }

    const response = await fetch(
      `${this.baseUrl}/api/v1/admin/invoices/${invoiceId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.adminApiKey}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to get invoice: ${error.error}`);
    }

    return await response.json();
  }

  /**
   * List payments
   */
  async listPayments(params: {
    organisationId: string;
    invoiceId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    payments: Array<{
      id: string;
      paymentNumber: string;
      amount: string;
      status: string;
      createdAt: string;
    }>;
    total: number;
  }> {
    if (!this.adminApiKey) {
      throw new Error('Admin API key required');
    }

    const queryParams = new URLSearchParams();
    if (params.invoiceId) queryParams.set('invoiceId', params.invoiceId);
    if (params.status) queryParams.set('status', params.status);
    if (params.startDate) queryParams.set('startDate', params.startDate);
    if (params.endDate) queryParams.set('endDate', params.endDate);
    if (params.limit) queryParams.set('limit', String(params.limit));
    if (params.offset) queryParams.set('offset', String(params.offset));

    const response = await fetch(
      `${this.baseUrl}/api/v1/admin/organisations/${params.organisationId}/payments?${queryParams}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.adminApiKey}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to list payments: ${error.error}`);
    }

    return await response.json();
  }
}

// Example usage
async function example() {
  const client = new BillingPlatformClient({
    baseUrl: 'https://api.example.com',
    adminApiKey: process.env.ADMIN_API_KEY,
  });

  // Create organisation
  const org = await client.createOrganisation({
    name: 'Acme Corp',
    billingEmail: 'billing@acme.com',
  });

  // Create project
  const project = await client.createProject({
    organisationId: org.id,
    name: 'My Project',
  });

  // Use project API key for event ingestion
  const eventClient = new BillingPlatformClient({
    baseUrl: 'https://api.example.com',
    projectApiKey: project.apiKey,
  });

  // Ingest events
  for (let i = 0; i < 10; i++) {
    await eventClient.ingestEvent({
      eventId: `event-${Date.now()}-${i}`,
      metricName: 'api_calls',
      metricValue: 1,
      unit: 'count',
    });
  }

  // Get usage summary
  const usage = await client.getUsageSummary({
    organisationId: org.id,
    startMonth: 1,
    startYear: 2024,
  });

  console.log('Usage:', usage);
}

export { BillingPlatformClient };
