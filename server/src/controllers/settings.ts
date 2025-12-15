import type { Core } from '@strapi/strapi';

interface SettingsRequestBody {
  difyEndpoint?: string;
  difyApiKey?: string;
  callbackUrl?: string;
  callbackBasePath?: string;
  difyUser?: string;
  sourceLocale?: string;
}

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Get plugin settings
   */
  async getSettings(ctx: any) {
    try {
      const settings = await strapi
        .plugin('dify-translations')
        .service('settings')
        .getSettings();

      // Mask the API key for security
      return ctx.send({
        ...settings,
        difyApiKey: settings.difyApiKey ? '••••••••' : '',
      });
    } catch (error: any) {
      strapi.log.error('Get settings error:', error);
      return ctx.badRequest(error.message || 'Failed to get settings');
    }
  },

  /**
   * Update plugin settings
   */
  async setSettings(ctx: any) {
    const body = ctx.request.body as SettingsRequestBody;

    try {
      // Get current settings to preserve the API key if not changed
      const currentSettings = await strapi
        .plugin('dify-translations')
        .service('settings')
        .getSettings();

      // If the API key is masked, don't update it
      const settingsToUpdate = { ...body };
      if (settingsToUpdate.difyApiKey === '••••••••') {
        settingsToUpdate.difyApiKey = currentSettings.difyApiKey;
      }

      const settings = await strapi
        .plugin('dify-translations')
        .service('settings')
        .setSettings(settingsToUpdate);

      // Mask the API key in response
      return ctx.send({
        ...settings,
        difyApiKey: settings.difyApiKey ? '••••••••' : '',
      });
    } catch (error: any) {
      strapi.log.error('Set settings error:', error);
      return ctx.badRequest(error.message || 'Failed to save settings');
    }
  },
});

export default controller;
