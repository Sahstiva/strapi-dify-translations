import type { Core } from '@strapi/strapi';

interface TranslateRequestBody {
  documentId: string;
  contentType: string;
}

interface CallbackRequestBody {
  document_id: string;
  locale: string;
  fields: Record<string, unknown>;
  metadata?: {
    success?: string;
    error?: string;
  };
}

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Send content to Dify for translation
   */
  async translate(ctx: any) {
    const { documentId, contentType } = ctx.request.body as TranslateRequestBody;

    if (!documentId || !contentType) {
      return ctx.badRequest('Missing documentId or contentType');
    }

    try {
      const result = await strapi
        .plugin('dify-translations')
        .service('translation')
        .sendToTranslation(documentId, contentType);

      return ctx.send(result);
    } catch (error: any) {
      strapi.log.error('Translation error:', error);
      return ctx.badRequest(error.message || 'Translation failed');
    }
  },

  /**
   * Receive translated content from Dify workflow
   */
  async callback(ctx: any) {
    const { document_id, locale, fields, metadata } = ctx.request.body as CallbackRequestBody;
    const { content_type: contentType } = ctx.query;

    if (!document_id || !locale || !fields || !contentType) {
      return ctx.badRequest('Missing required fields: document_id, locale, fields, or content_type query parameter');
    }

    try {
      const result = await strapi
        .plugin('dify-translations')
        .service('translation')
        .storeTranslation(document_id, contentType, locale, fields, metadata);

      return ctx.send(result);
    } catch (error: any) {
      strapi.log.error('Callback error:', error);
      return ctx.badRequest(error.message || 'Failed to store translation');
    }
  },

  /**
   * Get plugin configuration
   */
  async getConfig(ctx: any) {
    const config = strapi.plugin('dify-translations').config;
    
    return ctx.send({
      difyEndpoint: config('difyEndpoint'),
      sourceLocale: config('sourceLocale'),
      callbackBasePath: config('callbackBasePath'),
      translatableFields: config('translatableFields'),
      // Don't expose API keys
    });
  },

  /**
   * Get available locales from i18n plugin
   */
  async getLocales(ctx: any) {
    try {
      const locales = await strapi
        .plugin('dify-translations')
        .service('translation')
        .getAvailableLocales();

      return ctx.send({ locales });
    } catch (error: any) {
      strapi.log.error('Get locales error:', error);
      return ctx.badRequest(error.message || 'Failed to get locales');
    }
  },

  /**
   * Get translatable fields from config
   */
  async getTranslatableFields(ctx: any) {
    try {
      const fields = strapi
        .plugin('dify-translations')
        .service('translation')
        .getTranslatableFields();

      return ctx.send({ fields });
    } catch (error: any) {
      strapi.log.error('Get translatable fields error:', error);
      return ctx.badRequest(error.message || 'Failed to get translatable fields');
    }
  },
});

export default controller;
