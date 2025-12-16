import type { Core } from '@strapi/strapi';

export interface ProgressEvent {
  jobId: string;
  type: 'started' | 'node_started' | 'node_finished' | 'completed' | 'error';
  message: string;
  current?: number;
  total?: number;
  nodeName?: string;
  index?: number;
}

interface TranslationJob {
  id: string;
  documentId: string;
  contentType: string;
  targetLocales: string[];
  startedAt: Date;
  status: 'running' | 'completed' | 'error';
  currentNode?: string;
  completedLocales: number;
  totalLocales: number;
  events: ProgressEvent[];
}

// Store active jobs in memory
const activeJobs = new Map<string, TranslationJob>();

const progressService = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Generate a unique job ID
   */
  generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  },

  /**
   * Add event to job
   */
  addEvent(jobId: string, event: Omit<ProgressEvent, 'index'>): void {
    const job = activeJobs.get(jobId);
    if (!job) return;

    const indexedEvent: ProgressEvent = {
      ...event,
      index: job.events.length,
    };
    job.events.push(indexedEvent);
  },

  /**
   * Get events for a job since a given index
   */
  getEvents(jobId: string, sinceIndex: number = 0): ProgressEvent[] {
    const job = activeJobs.get(jobId);
    if (!job) return [];
    return job.events.filter(e => (e.index || 0) >= sinceIndex);
  },

  /**
   * Start tracking a new translation job
   */
  startJob(jobId: string, documentId: string, contentType: string, targetLocales: string[]): void {
    const job: TranslationJob = {
      id: jobId,
      documentId,
      contentType,
      targetLocales,
      startedAt: new Date(),
      status: 'running',
      completedLocales: 0,
      totalLocales: targetLocales.length,
      events: [],
    };
    activeJobs.set(jobId, job);

    this.addEvent(jobId, {
      jobId,
      type: 'started',
      message: `Starting translation to ${targetLocales.length} language${targetLocales.length > 1 ? 's' : ''}`,
      current: 0,
      total: targetLocales.length,
    });
  },

  /**
   * Update job progress when a node starts
   */
  nodeStarted(jobId: string, nodeType: string, nodeTitle: string): void {
    const job = activeJobs.get(jobId);
    if (!job) return;

    const formattedName = this.formatNodeName(nodeTitle || nodeType);
    job.currentNode = formattedName;

    // Only add event for significant nodes (not start/end)
    if (nodeType !== 'start' && nodeType !== 'end') {
      this.addEvent(jobId, {
        jobId,
        type: 'node_started',
        message: formattedName,
        nodeName: formattedName,
        current: job.completedLocales,
        total: job.totalLocales,
      });
    }
  },

  /**
   * Update job progress when a node finishes
   */
  nodeFinished(jobId: string, nodeType: string, nodeTitle: string): void {
    const job = activeJobs.get(jobId);
    if (!job) return;

    // Track completed locales based on callback node
    if (nodeType === 'http-request' && nodeTitle.toLowerCase().includes('strapi')) {
      job.completedLocales++;
      
      const formattedName = this.formatNodeName(nodeTitle);
      this.addEvent(jobId, {
        jobId,
        type: 'node_finished',
        message: `Saved translation (${job.completedLocales}/${job.totalLocales})`,
        nodeName: formattedName,
        current: job.completedLocales,
        total: job.totalLocales,
      });
    }
  },

  /**
   * Mark job as completed
   */
  completeJob(jobId: string, success: boolean, message?: string): void {
    const job = activeJobs.get(jobId);
    if (!job) return;

    job.status = success ? 'completed' : 'error';

    this.addEvent(jobId, {
      jobId,
      type: success ? 'completed' : 'error',
      message: message || (success 
        ? `Translation completed for ${job.totalLocales} language${job.totalLocales > 1 ? 's' : ''}`
        : 'Translation failed'),
      current: job.completedLocales,
      total: job.totalLocales,
    });

    // Clean up job after 5 minutes
    setTimeout(() => {
      activeJobs.delete(jobId);
    }, 5 * 60 * 1000);
  },

  /**
   * Format node name for display (e.g., "send_to_strapi" -> "Send To Strapi")
   */
  formatNodeName(name: string): string {
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  },

  /**
   * Get job by ID
   */
  getJob(jobId: string): TranslationJob | undefined {
    return activeJobs.get(jobId);
  },
});

export default progressService;
