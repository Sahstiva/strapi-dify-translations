import type { Core } from '@strapi/strapi';
import { Agent } from 'undici';

const insecureAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

const service = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Get available locales from i18n plugin
   */
  async getAvailableLocales(): Promise<string[]> {
    try {
      // Try to get locales from i18n plugin
      const i18nPlugin = strapi.plugin('i18n');
      if (!i18nPlugin) {
        strapi.log.warn('i18n plugin not found, returning default locale');
        return ['en'];
      }

      const locales = await strapi.db.query('plugin::i18n.locale').findMany({
        select: ['code', 'name'],
      });

      return locales.map((locale: any) => locale.code);
    } catch (error) {
      strapi.log.error('Error getting locales:', error);
      return ['en'];
    }
  },

  /**
   * Get configured translatable fields
   */
  getTranslatableFields(): string[] {
    const pluginConfig = strapi.plugin('dify-translations').config;
    const translatableFields = pluginConfig('translatableFields') as string[];
    return translatableFields || [];
  },

  /**
   * Get content data for translation
   */
  async getContentForTranslation(documentId: string, contentType: string): Promise<Record<string, unknown>> {
    const pluginConfig = strapi.plugin('dify-translations').config;
    const sourceLocale = pluginConfig('sourceLocale') as string;

    // Get configured translatable fields
    const translatableFields = this.getTranslatableFields();

    if (translatableFields.length === 0) {
      throw new Error('No translatable fields configured. Please set translatableFields in plugin config.');
    }

    // Fetch the document using Document Service API
    const document = await strapi.documents(contentType as any).findOne({
      documentId,
      locale: sourceLocale,
    });

    if (!document) {
      throw new Error(`Document ${documentId} not found for locale ${sourceLocale}`);
    }

    // Extract only configured fields that exist and have values
    const fieldsToTranslate: Record<string, unknown> = {};
    for (const field of translatableFields) {
      const value = document[field];
      // Skip fields that don't exist or have no value (null, undefined, empty string)
      if (value !== undefined && value !== null && value !== '') {
        fieldsToTranslate[field] = value;
      }
    }

    return fieldsToTranslate;
  },

  /**
   * Send content to Dify for translation
   */
  async sendToTranslation(documentId: string, contentType: string): Promise<{ success: boolean; message: string }> {
    const pluginConfig = strapi.plugin('dify-translations').config;
    const difyEndpoint = pluginConfig('difyEndpoint') as string;
    const difyApiKey = pluginConfig('difyApiKey') as string;
    const sourceLocale = pluginConfig('sourceLocale') as string;
    const serverUrl = pluginConfig('callbackUrl') as string;
    const callbackBasePath = pluginConfig('callbackBasePath') as string;
    const difyUser = pluginConfig('difyUser') as string;

    if (!difyEndpoint) {
      throw new Error('Dify endpoint is not configured');
    }

    // Get available locales
    const allLocales = await this.getAvailableLocales();
    const targetLocales = allLocales.filter(locale => locale !== sourceLocale);

    if (targetLocales.length === 0) {
      throw new Error('No target locales available for translation');
    }

    // Get content to translate
    const fields = await this.getContentForTranslation(documentId, contentType);

    if (Object.keys(fields).length === 0) {
      throw new Error('No translatable content found');
    }

    // Build callback URL
    const callbackUrl = `${serverUrl}/api${callbackBasePath}?content_type=${encodeURIComponent(contentType)}`;

    // Prepare payload for Dify with new structure
    const payload = {
      inputs: {
        document_id: documentId,
        ...fields,
        source_locale: sourceLocale,
        target_locales: JSON.stringify(targetLocales),
        callback_url: callbackUrl,
      },
      response_mode: 'blocking',
      user: difyUser,
    };

    strapi.log.info('Sending translation request to Dify:', JSON.stringify(payload, null, 2));

    // Send to Dify endpoint (fire-and-forget, don't wait for response)
    fetch(difyEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(difyApiKey ? { 'Authorization': `Bearer ${difyApiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      // @ts-expect-error: dispatcher is a undici option
      dispatcher: insecureAgent,
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorText = await response.text();
          strapi.log.error(`Dify API error: ${response.status} - ${errorText}`);
        } else {
          strapi.log.info('Dify translation request accepted');
        }
      })
      .catch((error) => {
        strapi.log.error('Error sending to Dify:', error);
      });

    // Return immediately without waiting for Dify response
    return {
      success: true,
      message: `Translation request sent for ${targetLocales.length} locales. Results will be delivered via callback.`,
    };
  },

  /**
   * Store translated content from Dify callback
   */
  async storeTranslation(
    documentId: string,
    contentType: string,
    locale: string,
    fields: Record<string, unknown>,
    metadata?: { success?: string; error?: string }
  ): Promise<{ success: boolean; message: string }> {
    // Check metadata for errors
    if (metadata?.success === 'false' || metadata?.error) {
      strapi.log.error(`Translation failed for ${documentId} locale ${locale}: ${metadata.error}`);
      return {
        success: false,
        message: `Translation failed: ${metadata.error || 'Unknown error'}`,
      };
    }

    // Validate content type exists
    const contentTypeSchema = strapi.contentTypes[contentType];
    if (!contentTypeSchema) {
      throw new Error(`Content type ${contentType} not found`);
    }

    // Get configured translatable fields to validate incoming data
    const translatableFields = this.getTranslatableFields();

    // Filter fields to only include configured translatable ones
    const validFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (translatableFields.length === 0 || translatableFields.includes(key)) {
        validFields[key] = value;
      } else {
        strapi.log.warn(`Field ${key} is not in translatable fields config for ${contentType}, skipping`);
      }
    }

    if (Object.keys(validFields).length === 0) {
      throw new Error('No valid translatable fields provided');
    }

    strapi.log.info(`Storing translation for ${contentType} (${documentId}) in locale ${locale}`);

    try {
      // Check if locale version already exists
      const existingEntry = await strapi.documents(contentType as any).findOne({
        documentId,
        locale,
      });

      if (existingEntry) {
        // Update existing locale version
        await strapi.documents(contentType as any).update({
          documentId,
          locale,
          data: {
            ...validFields,
            publishedAt: null, // Keep as draft
          },
        });

        strapi.log.info(`Updated existing translation for ${contentType} (${documentId}) in locale ${locale}`);
      } else {
        // Create new locale version using Document Service API
        await strapi.documents(contentType as any).update({
          documentId,
          locale,
          data: {
            ...validFields,
            publishedAt: null, // Keep as draft
          },
        });

        strapi.log.info(`Created new translation for ${contentType} (${documentId}) in locale ${locale}`);
      }

      return {
        success: true,
        message: `Translation stored for locale ${locale}`,
      };
    } catch (error: any) {
      strapi.log.error('Error storing translation:', error);
      throw new Error(`Failed to store translation: ${error.message}`);
    }
  },
});

export default service;
