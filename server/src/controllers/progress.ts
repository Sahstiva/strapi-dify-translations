import type { Core } from '@strapi/strapi';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Get progress events for a job (polling endpoint)
   */
  async getProgress(ctx: any) {
    try {
      const progressService = strapi.plugin('dify-translations').service('progress');
      const { jobId } = ctx.params;
      const sinceIndex = parseInt(ctx.query.since || '0', 10);
      
      if (!jobId) {
        return ctx.badRequest('jobId is required');
      }

      const events = progressService.getEvents(jobId, sinceIndex);
      
      return ctx.send({
        jobId,
        events,
      });
    } catch (error: any) {
      strapi.log.error('Get progress error:', error);
      return ctx.badRequest(error.message || 'Failed to get progress');
    }
  },
});

export default controller;
