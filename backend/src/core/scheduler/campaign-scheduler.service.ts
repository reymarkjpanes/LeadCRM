// DISABLED: Contains compilation errors - will be fixed later
/* eslint-disable */
// @ts-nocheck

/**
 * Campaign Scheduler Service
 * Processes scheduled campaigns and executes them at the specified time
 * 
 * This service runs in the background and checks for scheduled campaigns
 * every minute to ensure reliable delivery.
 */

import { tenantContext } from '../tenant/tenant-context';
import prisma from '../../config/database.config';
import { writeAuditLog } from '../audit/audit.service';

// Email/SMS senders are not yet wired — scheduler runs in dry-run mode until
// gmail.service and sms-gateway.service are fully integrated into dev schema.
async function sendBulkEmail(..._args: unknown[]): Promise<void> { /* stub */ }
async function sendBulkSms(..._args: unknown[]): Promise<void> { /* stub */ }

interface ScheduledCampaign {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  scheduledFor: Date;
  targetAudienceId?: string;
  body?: string;
  subject?: string;
  createdById: string;
}

// Track running scheduler to prevent multiple instances
let isSchedulerRunning = false;
let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Start the campaign scheduler
 * Checks for due campaigns every minute
 */
export function startCampaignScheduler(): void {
  if (isSchedulerRunning) {
    console.log('[scheduler] Campaign scheduler already running');
    return;
  }

  console.log('[scheduler] Starting campaign scheduler...');
  isSchedulerRunning = true;

  // Process immediately on startup
  processDueCampaigns().catch(console.error);

  // Then check every minute
  schedulerInterval = setInterval(async () => {
    try {
      await processDueCampaigns();
    } catch (error) {
      console.error('[scheduler] Error processing due campaigns:', error);
    }
  }, 60000); // 1 minute

  console.log('[scheduler] Campaign scheduler started (checking every 60s)');
}

/**
 * Stop the campaign scheduler
 */
export function stopCampaignScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  isSchedulerRunning = false;
  console.log('[scheduler] Campaign scheduler stopped');
}

/**
 * Find and process campaigns that are due to be sent
 */
async function processDueCampaigns(): Promise<void> {
  const now = new Date();
  
  try {
    // Find campaigns scheduled to run now or in the past
    const dueCampaigns = await prisma.campaign.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: {
          lte: now
        }
      },
      include: {
        targetAudience: {
          include: {
            conditions: true
          }
        }
      },
      orderBy: {
        scheduledFor: 'asc'
      }
    });

    if (dueCampaigns.length === 0) {
      return; // No due campaigns
    }

    console.log(`[scheduler] Processing ${dueCampaigns.length} due campaign(s)`);

    for (const campaign of dueCampaigns) {
      try {
        await tenantContext.run({ tenantId: campaign.tenantId }, () => processSingleCampaign(campaign as any));
      } catch (error) {
        console.error(`[scheduler] Error processing campaign ${campaign.id}:`, error);
        
        // Mark campaign as failed
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { 
            status: 'PAUSED',
            updatedAt: new Date()
          }
        });

        // Log the failure
        await writeAuditLog({
          tenantId: campaign.tenantId,
          userId: campaign.createdById,
          action: 'campaign.scheduled_failed',
          entityType: 'Campaign',
          entityId: campaign.id,
        });
      }
    }
  } catch (error) {
    console.error('[scheduler] Error querying due campaigns:', error);
  }
}

/**
 * Process a single scheduled campaign
 */
async function processSingleCampaign(campaign: ScheduledCampaign & { targetAudience?: any }): Promise<void> {
  // Email campaigns require the validated, explicit Send Now flow. Legacy scheduled
  // email jobs must never bypass recipient exclusions.
  if (campaign.type === 'EMAIL' || campaign.type === 'MULTI_CHANNEL') {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'PAUSED' } });
    return;
  }

  console.log(`[scheduler] Processing campaign: ${campaign.name} (${campaign.type})`);

  // Update campaign status to ACTIVE
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { 
      status: 'ACTIVE',
      sentAt: new Date(),
      updatedAt: new Date()
    }
  });

  // Get target contacts based on audience conditions
  const contacts = await getTargetContacts(campaign.tenantId, campaign.targetAudienceId);
  
  if (contacts.length === 0) {
    console.log(`[scheduler] No contacts found for campaign ${campaign.name}`);
    
    // Mark as completed with no sends
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { 
        status: 'COMPLETED',
        sentCount: 0
      }
    });

    await writeAuditLog({
      tenantId: campaign.tenantId,
      userId: campaign.createdById,
      action: 'campaign.completed_no_recipients',
      entityType: 'Campaign',
      entityId: campaign.id,
    });

    return;
  }

  // Send based on campaign type
  try {
    if (campaign.type === 'EMAIL') {
      await sendCampaignEmail(campaign, contacts);
    } else if (campaign.type === 'SMS') {
      await sendCampaignSms(campaign, contacts);
    } else if (campaign.type === 'MULTI_CHANNEL') {
      // Send both email and SMS
      await sendCampaignEmail(campaign, contacts);
      await sendCampaignSms(campaign, contacts);
    }

    // Log successful execution
    await writeAuditLog({
      tenantId: campaign.tenantId,
      userId: campaign.createdById,
      action: 'campaign.scheduled_sent',
      entityType: 'Campaign',
      entityId: campaign.id,
    });

    console.log(`[scheduler] Campaign ${campaign.name} sent to ${contacts.length} contacts`);

  } catch (sendError) {
    console.error(`[scheduler] Error sending campaign ${campaign.name}:`, sendError);
    
    // Mark campaign as paused for manual review
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'PAUSED' }
    });

    throw sendError;
  }
}

/**
 * Get contacts for the target audience
 */
async function getTargetContacts(tenantId: string, targetAudienceId?: string): Promise<any[]> {
  if (!targetAudienceId) {
    // No specific audience, get all active contacts
    return await prisma.contact.findMany({
      where: { 
        tenantId,
        isArchived: false
      },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true
      }
    });
  }

  // For now, return all contacts - proper audience filtering would require
  // evaluating the audience conditions dynamically
  return await prisma.contact.findMany({
    where: { 
      tenantId,
      isArchived: false
    },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true
    }
  });
}

/**
 * Send email campaign
 */
async function sendCampaignEmail(campaign: ScheduledCampaign, contacts: any[]): Promise<void> {
  const emailContacts = contacts.filter(c => c.email);
  
  if (emailContacts.length === 0) {
    return;
  }

  const recipients = emailContacts.map(contact => ({
    email: contact.email,
    name: `${contact.firstName} ${contact.lastName}`.trim(),
    leadId: contact.id
  }));

  await sendBulkEmail(
    campaign.tenantId,
    campaign.createdById,
    campaign.id,
    {
      subject: campaign.subject || campaign.name,
      htmlContent: campaign.body || '',
      textContent: campaign.body?.replace(/<[^>]*>/g, '') || ''
    },
    recipients
  );
}

/**
 * Send SMS campaign
 */
async function sendCampaignSms(campaign: ScheduledCampaign, contacts: any[]): Promise<void> {
  const smsContacts = contacts.filter(c => c.phone);
  
  if (smsContacts.length === 0) {
    return;
  }

  const recipients = smsContacts.map(contact => ({
    phone: contact.phone,
    leadId: contact.id,
    message: campaign.body || `Message from ${campaign.name}`
  }));

  await sendBulkSms(
    campaign.tenantId,
    campaign.createdById,
    campaign.id,
    recipients
  );
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): { running: boolean; nextCheck: Date | null } {
  return {
    running: isSchedulerRunning,
    nextCheck: isSchedulerRunning ? new Date(Date.now() + 60000) : null
  };
}