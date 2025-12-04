export default {
  type: 'admin',
  routes: [
    {
      method: 'POST',
      path: '/translate',
      handler: 'translation.translate',
      config: {
        policies: [],
        description: 'Send content to Dify for translation',
      },
    },
    {
      method: 'GET',
      path: '/config',
      handler: 'translation.getConfig',
      config: {
        policies: [],
        description: 'Get plugin configuration',
      },
    },
    {
      method: 'GET',
      path: '/locales',
      handler: 'translation.getLocales',
      config: {
        policies: [],
        description: 'Get available locales',
      },
    },
    {
      method: 'GET',
      path: '/translatable-fields',
      handler: 'translation.getTranslatableFields',
      config: {
        policies: [],
        description: 'Get translatable fields from config',
      },
    },
  ],
};

