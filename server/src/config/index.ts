export default {
  default: {
    // Default endpoint for Dify workflow
    difyEndpoint: '',
    // API key for Dify authentication (outgoing requests)
    difyApiKey: '',
    // API token for callback authentication (incoming requests)
    callbackApiToken: '',
    // Source locale for translations
    sourceLocale: 'en',
    // Callback URL base (will be combined with Strapi URL)
    callbackBasePath: '/dify-translations/callback',
    // Translatable field types
    translatableFieldTypes: ['string', 'text', 'richtext', 'blocks'],
  },
  validator: (config: Record<string, unknown>) => {
    if (config.difyEndpoint && typeof config.difyEndpoint !== 'string') {
      throw new Error('difyEndpoint must be a string');
    }
    if (config.difyApiKey && typeof config.difyApiKey !== 'string') {
      throw new Error('difyApiKey must be a string');
    }
    if (config.callbackApiToken && typeof config.callbackApiToken !== 'string') {
      throw new Error('callbackApiToken must be a string');
    }
    if (config.sourceLocale && typeof config.sourceLocale !== 'string') {
      throw new Error('sourceLocale must be a string');
    }
  },
};

