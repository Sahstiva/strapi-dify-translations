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
   */
  isNestedField(fieldPath: string): boolean {
    return fieldPath.includes('.');
  },

  /**
   * Parse a nested field path into component and field parts
   */
  parseNestedField(fieldPath: string): { component: string; field: string } | null {
    const parts = fieldPath.split('.');
    if (parts.length !== 2) {
      return null;
    }
    return { component: parts[0], field: parts[1] };
  },

  /**
   * Convert internal field name (dot notation) to Dify-compatible format (underscore)
   */
  toDifyFieldName(fieldPath: string): string {
    return fieldPath.replace('.', '_');
  },

  /**
   * Convert Dify field name (underscore) back to internal format (dot notation)
   */
  fromDifyFieldName(difyFieldName: string, translatableFields: string[]): string {
    for (const configField of translatableFields) {
      if (this.toDifyFieldName(configField) === difyFieldName) {
        return configField;
      }
    }
    return difyFieldName;
  },

  /**
   * Get a nested value from a document using dot notation
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

    if (!data[parsed.component]) {
      if (existingComponent && typeof existingComponent === 'object') {
        data[parsed.component] = { ...existingComponent as Record<string, unknown> };
      } else {
        data[parsed.component] = {};
      }
    }

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
    const translatableFields = this.getTranslatableFields();

    if (translatableFields.length === 0) {
      throw new Error('No translatable fields configured. Please set translatableFields in plugin config.');
    }

    const componentsToPopulate: Set<string> = new Set();
    for (const field of translatableFields) {
      if (this.isNestedField(field)) {
        const parsed = this.parseNestedField(field);
        if (parsed && this.fieldExistsInSchema(contentType, parsed.component)) {
          componentsToPopulate.add(parsed.component);
        }
      }
    }

    const populate: Record<string, boolean> = {};
    for (const component of componentsToPopulate) {
      populate[component] = true;
    }

    const document = await strapi.documents(contentType as any).findOne({
      documentId,
      locale: sourceLocale,
      populate: Object.keys(populate).length > 0 ? populate : undefined,
    });

    if (!document) {
      throw new Error(`Document ${documentId} not found for locale ${sourceLocale}`);
    }

    const fieldsToTranslate: Record<string, unknown> = {};
    for (const field of translatableFields) {
      let value: unknown;

      if (this.isNestedField(field)) {
        const parsed = this.parseNestedField(field);
        if (!parsed || !this.fieldExistsInSchema(contentType, parsed.component)) {
          continue;
        }
        value = this.getNestedValue(document, field);
      } else {
        value = document[field];
      }

      if (value !== undefined && value !== null && value !== '') {
        const difyFieldName = this.toDifyFieldName(field);
        fieldsToTranslate[difyFieldName] = value;
      }
    }

    return fieldsToTranslate;
  },

  /**
   * Send content to Dify for translation
   */
  async sendToTranslation(
    documentId: string,
    contentType: string,
    selectedLocales?: string[]
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    const settings = await this.getPluginSettings();
    const progressService = strapi.plugin('dify-translations').service('progress');

    const difyEndpoint = settings.difyEndpoint;
    const difyApiKey = settings.difyApiKey;
    const sourceLocale = settings.sourceLocale;
    const callbackUrl = settings.callbackUrl;
    const callbackBasePath = settings.callbackBasePath;
    const difyUser = settings.difyUser;

    if (!difyEndpoint) {
      throw new Error('Dify endpoint is not configured');
    }

    let targetLocales: string[];
    if (selectedLocales && selectedLocales.length > 0) {
      targetLocales = selectedLocales.filter(locale => locale !== sourceLocale);
    } else {
      const allLocales = await this.getAvailableLocales();
      targetLocales = allLocales
        .map(locale => locale.code)
        .filter(code => code !== sourceLocale);
    }

    if (targetLocales.length === 0) {
      throw new Error('No target locales available for translation');
    }

    const fields = await this.getContentForTranslation(documentId, contentType);

    if (Object.keys(fields).length === 0) {
      throw new Error('No translatable content found');
    }

    const finalCallbackUrl = `${callbackUrl}${callbackBasePath}?content_type=${encodeURIComponent(contentType)}`;

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

    const jobId = progressService.generateJobId();

    strapi.log.info(`[${jobId}] Sending translation request to Dify for ${targetLocales.length} locale(s)`);

    progressService.startJob(jobId, documentId, contentType, targetLocales);

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
          strapi.log.error(`[${jobId}] Dify API error: ${response.status} - ${errorText}`);
          progressService.completeJob(jobId, false, `Dify API error: ${response.status}`);
          return;
        }

        if (!response.body) {
          progressService.completeJob(jobId, false, 'Dify response has no body');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

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

                    switch (eventType) {
                      case 'node_started':
                        progressService.nodeStarted(jobId, eventData.data?.node_type || 'unknown', eventData.data?.title || '');
                        break;
                      case 'node_finished':
                        progressService.nodeFinished(jobId, eventData.data?.node_type || 'unknown', eventData.data?.title || '');
                        break;
                      case 'workflow_finished':
                        const success = eventData.data?.status === 'succeeded';
                        progressService.completeJob(jobId, success, success ? undefined : `Workflow status: ${eventData.data?.status}`);
                        break;
                      case 'error':
                        strapi.log.error(`[${jobId}] Dify error: ${eventData.message || JSON.stringify(eventData)}`);
                        progressService.completeJob(jobId, false, eventData.message || 'Dify workflow error');
                        break;
                    }
                  } catch {
                    // Not valid JSON, ignore
                  }
                }
                currentEvent = '';
              }
            }
          }
        } catch (streamError: any) {
          strapi.log.error(`[${jobId}] Error reading Dify stream: ${streamError.message}`);
          progressService.completeJob(jobId, false, `Stream error: ${streamError.message}`);
        }
      })
      .catch((error) => {
        strapi.log.error(`[${jobId}] Error sending to Dify:`, error);
        progressService.completeJob(jobId, false, `Failed to connect to Dify: ${error.message}`);
      });

    return {
      success: true,
      message: `Translation request sent for ${targetLocales.length} locale(s)`,
      jobId,
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
   * Get all localizable fields from content type schema
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
      if (excludedFields.includes(fieldName)) {
        continue;
      }
      if (attribute.private) {
        continue;
      }
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
        populate[fieldName] = {
          fields: ['id', 'documentId'],
        };
      } else if (attribute.type === 'component' || attribute.type === 'dynamiczone') {
        populate[fieldName] = true;
      } else if (attribute.type === 'media') {
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
   * Format relation value for update
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
        // Document doesn't exist in this locale
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
    if (metadata?.success === 'false' || metadata?.error) {
      strapi.log.error(`Translation failed for ${documentId} locale ${locale}: ${metadata.error}`);
      return {
        success: false,
        message: `Translation failed: ${metadata.error || 'Unknown error'}`,
      };
    }

    const contentTypeSchema = strapi.contentTypes[contentType] as ContentTypeSchema | undefined;
    if (!contentTypeSchema) {
      throw new Error(`Content type ${contentType} not found`);
    }

    const settings = await this.getPluginSettings();
    const sourceLocale = settings.sourceLocale;

    const translatableFields = this.getTranslatableFields();
    const relationFields = this.getRelationFields(contentType);
    const { components: componentFields, dynamicZones: dynamicZoneFields } = this.getComponentFields(contentType);
    const localizableFields = this.getLocalizableFields(contentType);

    const translatedRegularFields: Record<string, unknown> = {};
    const translatedNestedFields: Record<string, unknown> = {};

    for (const [difyKey, value] of Object.entries(fields)) {
      const internalKey = this.fromDifyFieldName(difyKey, translatableFields);
      
      if (translatableFields.length === 0 || translatableFields.includes(internalKey)) {
        if (this.isNestedField(internalKey)) {
          translatedNestedFields[internalKey] = value;
        } else {
          translatedRegularFields[internalKey] = value;
        }
      }
    }

    strapi.log.info(`Storing translation for ${contentType} (${documentId}) in locale ${locale}`);

    try {
      const populate = this.buildPopulateObject(contentType);

      const sourceDocument = await strapi.documents(contentType as any).findOne({
        documentId,
        locale: sourceLocale,
        populate,
      });

      if (!sourceDocument) {
        throw new Error(`Source document ${documentId} not found for locale ${sourceLocale}`);
      }

      const existingEntry = await strapi.documents(contentType as any).findOne({
        documentId,
        locale,
        populate,
      });

      const mergedData: Record<string, unknown> = {};

      for (const fieldName of localizableFields) {
        const sourceValue = sourceDocument[fieldName];
        const translatedValue = translatedRegularFields[fieldName];
        const existingValue = existingEntry?.[fieldName];

        if (relationFields.includes(fieldName)) {
          const relationTarget = this.getRelationTarget(contentType, fieldName);
          const isTargetLocalized = relationTarget ? this.isContentTypeLocalized(relationTarget) : false;
          const relationValue = existingValue || sourceValue;

          if (relationValue && relationTarget) {
            if (isTargetLocalized) {
              const allIds = this.extractRelationIds(relationValue);
              const existingIds = await this.filterExistingRelations(relationTarget, allIds, locale);

              if (existingIds.length > 0) {
                mergedData[fieldName] = {
                  connect: existingIds.map(id => ({ documentId: id })),
                };
              }
            } else {
              const formattedRelation = this.formatRelationForUpdate(relationValue);
              if (formattedRelation) {
                mergedData[fieldName] = formattedRelation;
              }
            }
          }
        } else if (componentFields.includes(fieldName) || dynamicZoneFields.includes(fieldName)) {
          const componentValue = existingValue ?? sourceValue;
          if (componentValue !== undefined && componentValue !== null) {
            mergedData[fieldName] = componentValue;
          }
        } else {
          if (translatedValue !== undefined && translatedValue !== null) {
            mergedData[fieldName] = translatedValue;
          } else if (existingValue !== undefined && existingValue !== null) {
            mergedData[fieldName] = existingValue;
          } else if (sourceValue !== undefined && sourceValue !== null) {
            mergedData[fieldName] = sourceValue;
          }
        }
      }

      for (const [nestedFieldPath, translatedValue] of Object.entries(translatedNestedFields)) {
        const parsed = this.parseNestedField(nestedFieldPath);
        if (!parsed || !this.fieldExistsInSchema(contentType, parsed.component)) {
          continue;
        }

        const sourceComponent = sourceDocument[parsed.component];
        const existingComponent = existingEntry?.[parsed.component];
        const baseComponent = mergedData[parsed.component] || existingComponent || sourceComponent;

        if (translatedValue !== undefined && translatedValue !== null) {
          this.setNestedValue(mergedData, nestedFieldPath, translatedValue, baseComponent);
        }
      }

      for (const configField of translatableFields) {
        if (this.isNestedField(configField) && !translatedNestedFields[configField]) {
          const parsed = this.parseNestedField(configField);
          if (parsed && this.fieldExistsInSchema(contentType, parsed.component)) {
            const sourceValue = this.getNestedValue(sourceDocument, configField);
            const existingValue = existingEntry ? this.getNestedValue(existingEntry, configField) : undefined;
            const valueToUse = existingValue ?? sourceValue;

            if (valueToUse !== undefined && valueToUse !== null) {
              const sourceComponent = sourceDocument[parsed.component];
              const existingComponent = existingEntry?.[parsed.component];
              const baseComponent = mergedData[parsed.component] || existingComponent || sourceComponent;
              this.setNestedValue(mergedData, configField, valueToUse, baseComponent);
            }
          }
        }
      }

      await strapi.documents(contentType as any).update({
        documentId,
        locale,
        data: {
          ...mergedData,
          publishedAt: null,
        },
      });

      const actionType = existingEntry ? 'Updated' : 'Created';
      strapi.log.info(`${actionType} translation for ${contentType} (${documentId}) in locale ${locale}`);

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
