import type { Core } from '@strapi/strapi';
import { Agent } from 'undici';

const insecureAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

interface AttributeSchema {
  type: string;
  relation?: string;
  target?: string;
  private?: boolean;
  writable?: boolean;
  configurable?: boolean;
  pluginOptions?: {
    i18n?: {
      localized?: boolean;
    };
  };
}

interface ContentTypeSchema {
  attributes: Record<string, AttributeSchema>;
  options?: {
    draftAndPublish?: boolean;
  };
}

const service = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Get plugin settings (from store, with config fallbacks)
   */
  async getPluginSettings() {
    return strapi.plugin('dify-translations').service('settings').getSettings();
  },

  /**
   * Get available locales from i18n plugin
   */
  async getAvailableLocales(): Promise<Array<{ code: string; name: string }>> {
    try {
      // Try to get locales from i18n plugin
      const i18nPlugin = strapi.plugin('i18n');
      if (!i18nPlugin) {
        strapi.log.warn('i18n plugin not found, returning default locale');
        return [{ code: 'en', name: 'English' }];
      }

      const locales = await strapi.db.query('plugin::i18n.locale').findMany({
        select: ['code', 'name'],
      });

      return locales.map((locale: any) => ({
        code: locale.code,
        name: locale.name || locale.code,
      }));
    } catch (error) {
      strapi.log.error('Error getting locales:', error);
      return [{ code: 'en', name: 'English' }];
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
   * Check if a field path is nested (contains dot notation)
   * e.g., "seo.title" returns true, "title" returns false
   */
  isNestedField(fieldPath: string): boolean {
    return fieldPath.includes('.');
  },

  /**
   * Parse a nested field path into component and field parts
   * e.g., "seo.title" returns { component: "seo", field: "title" }
   */
  parseNestedField(fieldPath: string): { component: string; field: string } | null {
    const parts = fieldPath.split('.');
    if (parts.length !== 2) {
      // Only support one level of nesting
      return null;
    }
    return { component: parts[0], field: parts[1] };
  },

  /**
   * Get a nested value from a document using dot notation
   * e.g., getNestedValue(doc, "seo.title") returns doc.seo.title
   */
  getNestedValue(document: Record<string, unknown>, fieldPath: string): unknown {
    const parsed = this.parseNestedField(fieldPath);
    if (!parsed) {
      return undefined;
    }

    const componentValue = document[parsed.component];
    if (!componentValue || typeof componentValue !== 'object') {
      return undefined;
    }

    return (componentValue as Record<string, unknown>)[parsed.field];
  },

  /**
   * Set a nested value in a data object using dot notation
   * Modifies the data object in place, creating the component object if needed
   */
  setNestedValue(
    data: Record<string, unknown>,
    fieldPath: string,
    value: unknown,
    existingComponent?: unknown
  ): void {
    const parsed = this.parseNestedField(fieldPath);
    if (!parsed) {
      return;
    }

    // Initialize component object if it doesn't exist
    if (!data[parsed.component]) {
      // Copy existing component data if available, otherwise create empty object
      if (existingComponent && typeof existingComponent === 'object') {
        data[parsed.component] = { ...existingComponent as Record<string, unknown> };
      } else {
        data[parsed.component] = {};
      }
    }

    // Set the nested field value
    (data[parsed.component] as Record<string, unknown>)[parsed.field] = value;
  },

  /**
   * Check if a field exists in the content type schema
   */
  fieldExistsInSchema(contentType: string, fieldName: string): boolean {
    const schema = strapi.contentTypes[contentType] as ContentTypeSchema | undefined;
    if (!schema) {
      return false;
    }
    return fieldName in schema.attributes;
  },

  /**
   * Get content data for translation
   */
  async getContentForTranslation(documentId: string, contentType: string): Promise<Record<string, unknown>> {
    const settings = await this.getPluginSettings();
    const sourceLocale = settings.sourceLocale;

    // Get configured translatable fields
    const translatableFields = this.getTranslatableFields();

    if (translatableFields.length === 0) {
      throw new Error('No translatable fields configured. Please set translatableFields in plugin config.');
    }

    // Build populate object for components that might contain nested fields
    // Only include components that actually exist in this content type
    const componentsToPopulate: Set<string> = new Set();
    for (const field of translatableFields) {
      if (this.isNestedField(field)) {
        const parsed = this.parseNestedField(field);
        if (parsed && this.fieldExistsInSchema(contentType, parsed.component)) {
          componentsToPopulate.add(parsed.component);
        }
      }
    }

    // Create populate config
    const populate: Record<string, boolean> = {};
    for (const component of componentsToPopulate) {
      populate[component] = true;
    }

    // Fetch the document using Document Service API
    const document = await strapi.documents(contentType as any).findOne({
      documentId,
      locale: sourceLocale,
      populate: Object.keys(populate).length > 0 ? populate : undefined,
    });

    if (!document) {
      throw new Error(`Document ${documentId} not found for locale ${sourceLocale}`);
    }

    // Extract only configured fields that exist and have values
    const fieldsToTranslate: Record<string, unknown> = {};
    for (const field of translatableFields) {
      let value: unknown;

      if (this.isNestedField(field)) {
        // Handle nested field (e.g., "seo.title")
        // Skip if the component doesn't exist in this content type
        const parsed = this.parseNestedField(field);
        if (!parsed || !this.fieldExistsInSchema(contentType, parsed.component)) {
          continue;
        }
        value = this.getNestedValue(document, field);
      } else {
        // Handle regular field
        value = document[field];
      }

      // Skip fields that don't exist or have no value (null, undefined, empty string)
      if (value !== undefined && value !== null && value !== '') {
        // Use dot notation as the key so Dify receives exact field names
        fieldsToTranslate[field] = value;
      }
    }

    return fieldsToTranslate;
  },

  /**
   * Send content to Dify for translation
   * @param documentId - The document ID to translate
   * @param contentType - The content type (e.g., 'api::article.article')
   * @param selectedLocales - Optional array of target locale codes. If not provided, all non-source locales are used.
   */
  async sendToTranslation(
    documentId: string,
    contentType: string,
    selectedLocales?: string[]
  ): Promise<{ success: boolean; message: string }> {
    const settings = await this.getPluginSettings();

    const difyEndpoint = settings.difyEndpoint;
    const difyApiKey = settings.difyApiKey;
    const sourceLocale = settings.sourceLocale;
    const callbackUrl = settings.callbackUrl;
    const callbackBasePath = settings.callbackBasePath;
    const difyUser = settings.difyUser;

    if (!difyEndpoint) {
      throw new Error('Dify endpoint is not configured');
    }

    // Determine target locales
    let targetLocales: string[];
    if (selectedLocales && selectedLocales.length > 0) {
      // Use user-selected locales, but filter out source locale if accidentally included
      targetLocales = selectedLocales.filter(locale => locale !== sourceLocale);
    } else {
      // Fallback to all available locales except source
      const allLocales = await this.getAvailableLocales();
      targetLocales = allLocales
        .map(locale => locale.code)
        .filter(code => code !== sourceLocale);
    }

    if (targetLocales.length === 0) {
      throw new Error('No target locales available for translation');
    }

    // Get content to translate
    const fields = await this.getContentForTranslation(documentId, contentType);

    if (Object.keys(fields).length === 0) {
      throw new Error('No translatable content found');
    }

    // Build callback URL from base URL and path
    const finalCallbackUrl = `${callbackUrl}${callbackBasePath}?content_type=${encodeURIComponent(contentType)}`;
    strapi.log.info(`Callback URL: ${finalCallbackUrl}`);

    // Prepare payload for Dify with new structure
    const payload = {
      inputs: {
        document_id: documentId,
        ...fields,
        source_locale: sourceLocale,
        target_locales: JSON.stringify(targetLocales),
        callback_url: finalCallbackUrl,
      },
      response_mode: 'streaming',
      user: difyUser,
    };

    strapi.log.info(`Sending translation request to Dify, number of fields to translate: ${Object.keys(fields).length}`);
    strapi.log.info(`Translating from ${sourceLocale} to ${targetLocales.join(', ')}`);

    // Send to Dify endpoint (fire-and-forget, don't wait for response)
    // Streaming mode returns Server-Sent Events (SSE)
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
          return;
        }

        strapi.log.info('Dify translation request accepted, receiving SSE stream...');

        // Process SSE stream
        if (!response.body) {
          strapi.log.warn('Dify response has no body');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              strapi.log.info('Dify SSE stream completed');
              break;
            }

            // Decode the chunk and add to buffer
            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events from buffer
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            let currentEvent = '';
            for (const line of lines) {
              const trimmedLine = line.trim();

              if (trimmedLine.startsWith('event:')) {
                currentEvent = trimmedLine.slice(6).trim();
              } else if (trimmedLine.startsWith('data:')) {
                const dataStr = trimmedLine.slice(5).trim();

                if (dataStr) {
                  try {
                    const eventData = JSON.parse(dataStr);
                    const eventType = currentEvent || eventData.event || 'unknown';

                    // Log different event types with appropriate info
                    switch (eventType) {
                      case 'workflow_started':
                        strapi.log.info(`[Dify] Workflow started: ${eventData.workflow_run_id || 'N/A'}`);
                        break;
                      case 'node_started':
                        strapi.log.info(`[Dify] Node started: ${eventData.data?.node_type || 'unknown'} - ${eventData.data?.title || 'N/A'}`);
                        break;
                      case 'node_finished':
                        strapi.log.info(`[Dify] Node finished: ${eventData.data?.node_type || 'unknown'} - ${eventData.data?.title || 'N/A'}`);
                        break;
                      case 'workflow_finished':
                        strapi.log.info(`[Dify] Workflow finished: status=${eventData.data?.status || 'unknown'}`);
                        break;
                      case 'text_chunk':
                        // Log text chunks at debug level to avoid spam
                        strapi.log.debug(`[Dify] Text chunk received`);
                        break;
                      case 'error':
                        strapi.log.error(`[Dify] Error: ${eventData.message || JSON.stringify(eventData)}`);
                        break;
                      default:
                        strapi.log.debug(`[Dify] Event: ${eventType}`);
                    }
                  } catch {
                    // Not valid JSON, log as raw data
                    strapi.log.debug(`[Dify] Raw data: ${dataStr.substring(0, 100)}...`);
                  }
                }
                currentEvent = ''; // Reset event after processing data
              }
            }
          }
        } catch (streamError: any) {
          strapi.log.error(`Error reading Dify SSE stream: ${streamError.message}`);
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
   * Get relation field names from content type schema
   */
  getRelationFields(contentType: string): string[] {
    const schema = strapi.contentTypes[contentType] as ContentTypeSchema | undefined;
    if (!schema) {
      return [];
    }

    const relationFields: string[] = [];
    for (const [fieldName, attribute] of Object.entries(schema.attributes)) {
      if (attribute.type === 'relation') {
        relationFields.push(fieldName);
      }
    }
    return relationFields;
  },

  /**
   * Get component and dynamic zone field names from content type schema
   */
  getComponentFields(contentType: string): { components: string[]; dynamicZones: string[] } {
    const schema = strapi.contentTypes[contentType] as ContentTypeSchema | undefined;
    if (!schema) {
      return { components: [], dynamicZones: [] };
    }

    const components: string[] = [];
    const dynamicZones: string[] = [];

    for (const [fieldName, attribute] of Object.entries(schema.attributes)) {
      if (attribute.type === 'component') {
        components.push(fieldName);
      } else if (attribute.type === 'dynamiczone') {
        dynamicZones.push(fieldName);
      }
    }

    return { components, dynamicZones };
  },

  /**
   * Get all localizable fields from content type schema (excluding system fields)
   */
  getLocalizableFields(contentType: string): string[] {
    const schema = strapi.contentTypes[contentType] as ContentTypeSchema | undefined;
    if (!schema) {
      return [];
    }

    const excludedFields = [
      'id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt',
      'createdBy', 'updatedBy', 'locale', 'localizations'
    ];

    const localizableFields: string[] = [];
    for (const [fieldName, attribute] of Object.entries(schema.attributes)) {
      // Skip system fields
      if (excludedFields.includes(fieldName)) {
        continue;
      }
      // Skip private fields
      if (attribute.private) {
        continue;
      }
      // Include the field if it's localizable (or i18n config is not set)
      const isLocalized = attribute.pluginOptions?.i18n?.localized !== false;
      if (isLocalized) {
        localizableFields.push(fieldName);
      }
    }

    return localizableFields;
  },

  /**
   * Build populate object for fetching all relations and components
   */
  buildPopulateObject(contentType: string): Record<string, boolean | object> {
    const schema = strapi.contentTypes[contentType] as ContentTypeSchema | undefined;
    if (!schema) {
      return {};
    }

    const populate: Record<string, boolean | object> = {};

    for (const [fieldName, attribute] of Object.entries(schema.attributes)) {
      if (attribute.type === 'relation') {
        // For relations, just populate with documentId
        populate[fieldName] = {
          fields: ['id', 'documentId'],
        };
      } else if (attribute.type === 'component' || attribute.type === 'dynamiczone') {
        // For components and dynamic zones, populate deeply
        populate[fieldName] = true;
      } else if (attribute.type === 'media') {
        // For media fields, get basic info
        populate[fieldName] = {
          fields: ['id', 'documentId', 'url', 'name'],
        };
      }
    }

    return populate;
  },

  /**
   * Extract relation IDs from a relation field value
   */
  extractRelationIds(value: unknown): string[] {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value
        .map((item: any) => item?.documentId || item?.id)
        .filter(Boolean) as string[];
    }

    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      const id = obj.documentId || obj.id;
      return id ? [String(id)] : [];
    }

    return [];
  },

  /**
   * Check if a content type is localized
   */
  isContentTypeLocalized(contentType: string): boolean {
    const schema = strapi.contentTypes[contentType] as ContentTypeSchema | undefined;
    if (!schema) {
      return false;
    }
    // Check if the content type has i18n enabled
    return (schema as any).pluginOptions?.i18n?.localized === true;
  },

  /**
   * Get the target content type for a relation field
   */
  getRelationTarget(contentType: string, fieldName: string): string | null {
    const schema = strapi.contentTypes[contentType] as ContentTypeSchema | undefined;
    if (!schema) {
      return null;
    }
    const attribute = schema.attributes[fieldName];
    if (attribute?.type === 'relation' && attribute.target) {
      return attribute.target;
    }
    return null;
  },

  /**
   * Format relation value for update (convert to connect format)
   */
  formatRelationForUpdate(
    value: unknown
  ): { connect: Array<{ documentId: string }> } | null {
    if (!value) {
      return null;
    }

    const ids = this.extractRelationIds(value);
    if (ids.length === 0) {
      return null;
    }

    return {
      connect: ids.map(id => ({ documentId: String(id) })),
    };
  },

  /**
   * Check if related documents exist in the target locale
   * Returns array of document IDs that exist in the target locale
   */
  async filterExistingRelations(
    relationTarget: string,
    documentIds: string[],
    locale: string
  ): Promise<string[]> {
    const existingIds: string[] = [];

    for (const docId of documentIds) {
      try {
        const doc = await strapi.documents(relationTarget as any).findOne({
          documentId: docId,
          locale,
        });
        if (doc) {
          existingIds.push(docId);
        }
      } catch (error) {
        // Document doesn't exist in this locale, skip it
        strapi.log.debug(`Related document ${docId} not found in locale ${locale}`);
      }
    }

    return existingIds;
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
    const contentTypeSchema = strapi.contentTypes[contentType] as ContentTypeSchema | undefined;
    if (!contentTypeSchema) {
      throw new Error(`Content type ${contentType} not found`);
    }

    const settings = await this.getPluginSettings();
    const sourceLocale = settings.sourceLocale;

    // Get configured translatable fields
    const translatableFields = this.getTranslatableFields();
    const relationFields = this.getRelationFields(contentType);
    const { components: componentFields, dynamicZones: dynamicZoneFields } = this.getComponentFields(contentType);
    const localizableFields = this.getLocalizableFields(contentType);

    // Separate regular and nested translated fields
    const translatedRegularFields: Record<string, unknown> = {};
    const translatedNestedFields: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(fields)) {
      if (translatableFields.length === 0 || translatableFields.includes(key)) {
        if (this.isNestedField(key)) {
          translatedNestedFields[key] = value;
        } else {
          translatedRegularFields[key] = value;
        }
      } else {
        strapi.log.warn(`Field ${key} is not in translatable fields config for ${contentType}, skipping`);
      }
    }

    strapi.log.info(`Storing translation for ${contentType} (${documentId}) in locale ${locale}`);
    strapi.log.debug(`Translated regular fields from Dify: ${Object.keys(translatedRegularFields).join(', ') || 'none'}`);
    strapi.log.debug(`Translated nested fields from Dify: ${Object.keys(translatedNestedFields).join(', ') || 'none'}`);

    try {
      // Build populate object for fetching source document
      const populate = this.buildPopulateObject(contentType);

      // Fetch the source document from default locale with all relations
      const sourceDocument = await strapi.documents(contentType as any).findOne({
        documentId,
        locale: sourceLocale,
        populate,
      });

      if (!sourceDocument) {
        throw new Error(`Source document ${documentId} not found for locale ${sourceLocale}`);
      }

      // Check if target locale version already exists
      const existingEntry = await strapi.documents(contentType as any).findOne({
        documentId,
        locale,
        populate,
      });

      // Build the merged data object
      const mergedData: Record<string, unknown> = {};

      // Process all localizable fields
      for (const fieldName of localizableFields) {
        const sourceValue = sourceDocument[fieldName];
        const translatedValue = translatedRegularFields[fieldName];
        const existingValue = existingEntry?.[fieldName];

        // Check if this is a relation field
        if (relationFields.includes(fieldName)) {
          // Check if the relation target is a localized content type
          const relationTarget = this.getRelationTarget(contentType, fieldName);
          const isTargetLocalized = relationTarget ? this.isContentTypeLocalized(relationTarget) : false;

          // Prefer existing value, fall back to source value
          const relationValue = existingValue || sourceValue;

          if (relationValue && relationTarget) {
            if (isTargetLocalized) {
              // For localized relations, check which related documents exist in target locale
              const allIds = this.extractRelationIds(relationValue);
              const existingIds = await this.filterExistingRelations(relationTarget, allIds, locale);

              if (existingIds.length > 0) {
                mergedData[fieldName] = {
                  connect: existingIds.map(id => ({ documentId: id })),
                };
                strapi.log.debug(`Relation ${fieldName}: ${existingIds.length}/${allIds.length} related documents exist in locale ${locale}`);
              } else if (allIds.length > 0) {
                strapi.log.warn(`Skipping relation ${fieldName} - none of ${allIds.length} related document(s) exist in locale ${locale}`);
              }
            } else {
              // For non-localized relations, copy directly
              const formattedRelation = this.formatRelationForUpdate(relationValue);
              if (formattedRelation) {
                mergedData[fieldName] = formattedRelation;
              }
            }
          }
        }
        // Check if this is a component or dynamic zone field
        else if (componentFields.includes(fieldName) || dynamicZoneFields.includes(fieldName)) {
          // For components/dynamic zones, use existing if available, otherwise copy from source
          const componentValue = existingValue ?? sourceValue;
          if (componentValue !== undefined && componentValue !== null) {
            mergedData[fieldName] = componentValue;
          }
        }
        // Regular field
        else {
          // Priority: translated value > existing value > source value
          if (translatedValue !== undefined && translatedValue !== null) {
            // Use translated value from Dify
            mergedData[fieldName] = translatedValue;
          } else if (existingValue !== undefined && existingValue !== null) {
            // Keep existing value in target locale
            mergedData[fieldName] = existingValue;
          } else if (sourceValue !== undefined && sourceValue !== null) {
            // Copy from source locale
            mergedData[fieldName] = sourceValue;
          }
        }
      }

      // Process nested fields (e.g., seo.title, seo.description)
      for (const [nestedFieldPath, translatedValue] of Object.entries(translatedNestedFields)) {
        const parsed = this.parseNestedField(nestedFieldPath);
        if (!parsed) {
          strapi.log.warn(`Invalid nested field path: ${nestedFieldPath}, skipping`);
          continue;
        }

        // Skip if the component doesn't exist in this content type
        if (!this.fieldExistsInSchema(contentType, parsed.component)) {
          strapi.log.debug(`Component ${parsed.component} doesn't exist in ${contentType}, skipping nested field ${nestedFieldPath}`);
          continue;
        }

        // Get the component from source, existing, or initialize
        const sourceComponent = sourceDocument[parsed.component];
        const existingComponent = existingEntry?.[parsed.component];
        const baseComponent = mergedData[parsed.component] || existingComponent || sourceComponent;

        if (translatedValue !== undefined && translatedValue !== null) {
          this.setNestedValue(mergedData, nestedFieldPath, translatedValue, baseComponent);
          strapi.log.debug(`Set nested field ${nestedFieldPath} with translated value`);
        }
      }

      // For components that have nested translated fields, also copy untranslated nested fields from source
      const nestedComponentsProcessed = new Set<string>();
      for (const nestedFieldPath of Object.keys(translatedNestedFields)) {
        const parsed = this.parseNestedField(nestedFieldPath);
        if (parsed && this.fieldExistsInSchema(contentType, parsed.component)) {
          nestedComponentsProcessed.add(parsed.component);
        }
      }

      // Check config for other nested fields that weren't translated and copy from source
      for (const configField of translatableFields) {
        if (this.isNestedField(configField) && !translatedNestedFields[configField]) {
          const parsed = this.parseNestedField(configField);
          if (parsed) {
            // Skip if the component doesn't exist in this content type
            if (!this.fieldExistsInSchema(contentType, parsed.component)) {
              continue;
            }

            // Get source value for this nested field
            const sourceValue = this.getNestedValue(sourceDocument, configField);
            const existingValue = existingEntry ? this.getNestedValue(existingEntry, configField) : undefined;
            const valueToUse = existingValue ?? sourceValue;

            if (valueToUse !== undefined && valueToUse !== null) {
              const sourceComponent = sourceDocument[parsed.component];
              const existingComponent = existingEntry?.[parsed.component];
              const baseComponent = mergedData[parsed.component] || existingComponent || sourceComponent;
              this.setNestedValue(mergedData, configField, valueToUse, baseComponent);
              strapi.log.debug(`Copied untranslated nested field ${configField} from source/existing`);
            }
          }
        }
      }

      strapi.log.debug(`Merged data fields: ${Object.keys(mergedData).join(', ')}`);

      // Update or create the locale version
      strapi.log.info(`Updating/creating locale version for ${contentType} (${documentId}) in locale ${locale}`);
      await strapi.documents(contentType as any).update({
        documentId,
        locale,
        data: {
          ...mergedData,
          publishedAt: null, // Keep as draft
        },
      });

      const allTranslatedFields = { ...translatedRegularFields, ...translatedNestedFields };
      const actionType = existingEntry ? 'Updated' : 'Created';
      strapi.log.info(`${actionType} translation for ${contentType} (${documentId}) in locale ${locale}`);
      strapi.log.info(`Translated fields: ${Object.keys(allTranslatedFields).join(', ') || 'none'}`);
      strapi.log.info(`Copied fields from source: ${localizableFields.filter(f =>
        !Object.keys(translatedRegularFields).includes(f) &&
        mergedData[f] !== undefined
      ).join(', ') || 'none'}`);

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
