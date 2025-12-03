export default {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/callback',
      handler: 'translation.callback',
      config: {
        policies: [],
        auth: false, // Allow external services to call this endpoint
        description: 'Receive translated content from Dify workflow',
      },
    },
  ],
};

