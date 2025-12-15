import type { Core } from '@strapi/strapi';

const STORE_KEY = 'settings';

interface PluginSettings {
  difyEndpoint: string;
  difyApiKey: string;
  callbackUrl: string;
  callbackBasePath: string;
  difyUser: string;
  sourceLocale: string;
}

const settingsService = ({ strapi }: { strapi: Core.Strapi }) => {
  // Get the plugin store
  const getPluginStore = () => {
    return strapi.store({ type: 'plugin', name: 'dify-translations' });
  };

  return {
    async getSettings(): Promise<PluginSettings> {
      const pluginStore = getPluginStore();
      const storedSettings = await pluginStore.get({ key: STORE_KEY });
      const pluginConfig = strapi.plugin('dify-translations').config;

      // Merge stored settings with config defaults
      const defaults: PluginSettings = {
        difyEndpoint: pluginConfig('difyEndpoint') || '',
        difyApiKey: pluginConfig('difyApiKey') || '',
        callbackUrl: pluginConfig('callbackUrl') || '',
        callbackBasePath: pluginConfig('callbackBasePath') || '/dify-translations/callback',
        difyUser: pluginConfig('difyUser') || 'strapi-user',
        sourceLocale: pluginConfig('sourceLocale') || 'en',
      };

      if (!storedSettings) {
        return defaults;
      }

      return {
        ...defaults,
        ...(storedSettings as Partial<PluginSettings>),
      };
    },

    async setSettings(settings: Partial<PluginSettings>): Promise<PluginSettings> {
      const currentSettings = await this.getSettings();

      const updatedSettings: PluginSettings = {
        ...currentSettings,
        ...settings,
      };

      const pluginStore = getPluginStore();
      await pluginStore.set({ key: STORE_KEY, value: updatedSettings });

      return updatedSettings;
    },

    async getSetting<K extends keyof PluginSettings>(key: K): Promise<PluginSettings[K]> {
      const settings = await this.getSettings();
      return settings[key];
    },
  };
};

export default settingsService;
