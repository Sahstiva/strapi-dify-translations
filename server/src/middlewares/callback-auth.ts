import type { Core } from '@strapi/strapi';

/**
 * Middleware to authenticate callback requests using API token
 */
const callbackAuth = (config: any, { strapi }: { strapi: Core.Strapi }) => {
  return async (ctx: any, next: () => Promise<void>) => {
    const pluginConfig = strapi.plugin('dify-translations').config;
    const callbackApiToken = pluginConfig('callbackApiToken') as string;

    // If no token is configured, allow all requests (backward compatibility)
    if (!callbackApiToken) {
      strapi.log.warn('Dify Translations: No callbackApiToken configured. Callback endpoint is unprotected!');
      return next();
    }

    // Get the authorization header
    const authHeader = ctx.request.headers.authorization;

    if (!authHeader) {
      ctx.status = 401;
      ctx.body = {
        error: {
          status: 401,
          name: 'UnauthorizedError',
          message: 'Missing authorization header',
        },
      };
      return;
    }

    // Support both "Bearer <token>" and just "<token>" formats
    let token = authHeader;
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7);
    }

    // Validate the token
    if (token !== callbackApiToken) {
      ctx.status = 401;
      ctx.body = {
        error: {
          status: 401,
          name: 'UnauthorizedError',
          message: 'Invalid API token',
        },
      };
      return;
    }

    // Token is valid, proceed
    return next();
  };
};

export default callbackAuth;

