export default {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/callback',
      handler: 'translation.callback',
      config: {
        policies: [],
        auth: false, // Disable Strapi's default auth, use custom middleware instead
        middlewares: ['plugin::dify-translations.callback-auth'],
        description: 'Receive translated content from Dify workflow',
      },
    },
  ],
};

