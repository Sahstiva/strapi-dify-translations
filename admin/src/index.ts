import { PLUGIN_ID } from './pluginId';
import { Initializer } from './components/Initializer';
import { TranslateWithDifyAction } from './components/TranslateAction';

export default {
  register(app: any) {
    app.registerPlugin({
      id: PLUGIN_ID,
      initializer: Initializer,
      isReady: false,
      name: PLUGIN_ID,
    });
  },

  bootstrap(app: any) {
    // Get the content-manager plugin to add header actions
    const contentManagerPlugin = app.getPlugin('content-manager');
    
    if (contentManagerPlugin && contentManagerPlugin.apis) {
      // Add the TranslateWithDifyAction to document header actions
      // Following the same pattern as strapi-plugin-translate
      contentManagerPlugin.apis.addDocumentHeaderAction([TranslateWithDifyAction]);
    }
  },

  async registerTrads({ locales }: { locales: string[] }) {
    const importedTranslations = await Promise.all(
      locales.map(async (locale) => {
        try {
          const data = await import(`./translations/${locale}.json`);
          return {
            data: prefixPluginTranslations(data.default, PLUGIN_ID),
            locale,
          };
        } catch {
          return {
            data: {},
            locale,
          };
        }
      })
    );

    return importedTranslations;
  },
};

const prefixPluginTranslations = (
  trad: Record<string, string>,
  pluginId: string
): Record<string, string> => {
  return Object.keys(trad).reduce(
    (acc, current) => {
      acc[`${pluginId}.${current}`] = trad[current];
      return acc;
    },
    {} as Record<string, string>
  );
};
