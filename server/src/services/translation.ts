import type { Core } from '@strapi/strapi';

interface TranslationRunRecord {
  documentId: string;
  contentType: string;
  locale: string;
  runId: string;
  processedAt: Date;
}

// In-memory store for idempotency (in production, use database)
const processedRuns = new Map<string, TranslationRunRecord>();

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
   * Get translatable fields for a content type
   */
  async getTranslatableFields(contentType: string): Promise<string[]> {
    const pluginConfig = strapi.plugin('dify-translations').config;
    const translatableTypes = pluginConfig('translatableFieldTypes') as string[];

    // Get content type schema
    const contentTypeSchema = strapi.contentTypes[contentType];
    if (!contentTypeSchema) {
      throw new Error(`Content type ${contentType} not found`);
    }

    const translatableFields: string[] = [];
    const attributes = contentTypeSchema.attributes;

    for (const [fieldName, fieldConfig] of Object.entries(attributes)) {
      const config = fieldConfig as any;
      
      // Check if the field type is translatable
      if (translatableTypes.includes(config.type)) {
        // Check if the field is localized (i18n enabled)
        const isLocalized = config.pluginOptions?.i18n?.localized === true;
        
        // Only include fields that are localized
        if (isLocalized) {
          translatableFields.push(fieldName);
        }
      }
    }

    return translatableFields;
  },

  /**
   * Get content data for translation
   */
  async getContentForTranslation(documentId: string, contentType: string): Promise<Record<string, unknown>> {
    const pluginConfig = strapi.plugin('dify-translations').config;
    const sourceLocale = pluginConfig('sourceLocale') as string;

    // Get translatable fields
    const translatableFields = await this.getTranslatableFields(contentType);

    // Fetch the document using Document Service API
    const document = await strapi.documents(contentType as any).findOne({
      documentId,
      locale: sourceLocale,
      fields: translatableFields as any,
    });

    if (!document) {
      throw new Error(`Document ${documentId} not found for locale ${sourceLocale}`);
    }

    // Extract only translatable fields
    const fieldsToTranslate: Record<string, unknown> = {};
    for (const field of translatableFields) {
      if (document[field] !== undefined && document[field] !== null) {
        fieldsToTranslate[field] = document[field];
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
    const callbackBasePath = pluginConfig('callbackBasePath') as string;

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
    const serverUrl = strapi.config.get('server.url') || `http://localhost:${strapi.config.get('server.port', 1337)}`;
    // Convert contentType from api::blog-post.blog-post to blog-posts (plural)
    const contentTypeSlug = contentType.split('.').pop()?.replace(/-/g, '-') || contentType;
    const callbackUrl = `${serverUrl}/api${callbackBasePath}?content_type=${encodeURIComponent(contentType)}`;

    // Prepare payload for Dify
    const payload = {
      document_id: documentId,
      fields,
      source_locale: sourceLocale,
      target_locales: targetLocales,
      callback_url: callbackUrl,
    };

    strapi.log.info('Sending translation request to Dify:', JSON.stringify(payload, null, 2));

    // Send to Dify endpoint
    try {
      const response = await fetch(difyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(difyApiKey ? { 'Authorization': `Bearer ${difyApiKey}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Dify API error: ${response.status} - ${errorText}`);
      }

      return {
        success: true,
        message: `Translation request sent for ${targetLocales.length} locales`,
      };
    } catch (error: any) {
      strapi.log.error('Error sending to Dify:', error);
      throw new Error(`Failed to send translation request: ${error.message}`);
    }
  },

  /**
   * Store translated content from Dify callback
   */
  async storeTranslation(
    documentId: string,
    contentType: string,
    locale: string,
    fields: Record<string, unknown>,
    runId: string
  ): Promise<{ success: boolean; message: string }> {
    // Check for idempotency
    const runKey = `${documentId}-${contentType}-${locale}-${runId}`;
    if (processedRuns.has(runKey)) {
      strapi.log.info(`Translation already processed for runId: ${runId}`);
      return {
        success: true,
        message: 'Translation already processed',
      };
    }

    // Validate content type exists
    const contentTypeSchema = strapi.contentTypes[contentType];
    if (!contentTypeSchema) {
      throw new Error(`Content type ${contentType} not found`);
    }

    // Get translatable fields to validate incoming data
    const translatableFields = await this.getTranslatableFields(contentType);
    
    // Filter fields to only include translatable ones
    const validFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (translatableFields.includes(key)) {
        validFields[key] = value;
      } else {
        strapi.log.warn(`Field ${key} is not translatable for ${contentType}, skipping`);
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
        // Create new locale version
        // First, get the source document to copy non-translatable fields
        const pluginConfig = strapi.plugin('dify-translations').config;
        const sourceLocale = pluginConfig('sourceLocale') as string;

        const sourceDocument = await strapi.documents(contentType as any).findOne({
          documentId,
          locale: sourceLocale,
        });

        if (!sourceDocument) {
          throw new Error(`Source document ${documentId} not found`);
        }

        // Get all field names that should be copied (non-translatable localized fields)
        const allAttributes = contentTypeSchema.attributes;
        const copyFields: Record<string, unknown> = {};

        for (const [fieldName, fieldConfig] of Object.entries(allAttributes)) {
          const config = fieldConfig as any;
          const isLocalized = config.pluginOptions?.i18n?.localized === true;
          
          // Copy localized fields that are not being translated
          if (isLocalized && !translatableFields.includes(fieldName) && sourceDocument[fieldName] !== undefined) {
            copyFields[fieldName] = sourceDocument[fieldName];
          }
        }

        // Create new locale version using Document Service API
        await strapi.documents(contentType as any).update({
          documentId,
          locale,
          data: {
            ...copyFields,
            ...validFields,
            publishedAt: null, // Keep as draft
          },
        });

        strapi.log.info(`Created new translation for ${contentType} (${documentId}) in locale ${locale}`);
      }

      // Mark run as processed for idempotency
      processedRuns.set(runKey, {
        documentId,
        contentType,
        locale,
        runId,
        processedAt: new Date(),
      });

      // Clean up old processed runs (keep last 1000)
      if (processedRuns.size > 1000) {
        const entries = Array.from(processedRuns.entries());
        entries.sort((a, b) => a[1].processedAt.getTime() - b[1].processedAt.getTime());
        for (let i = 0; i < entries.length - 1000; i++) {
          processedRuns.delete(entries[i][0]);
        }
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

