# Strapi Dify Translations Plugin

A Strapi 5 plugin to translate collection type content using Dify AI workflows.

## Features

- **Translate with Dify Button**: Adds a "Translate with Dify" action button in the Content Manager for collection types
- **Automatic Field Detection**: Automatically detects translatable fields (string, text, richtext, blocks) that are localized via i18n
- **Callback Endpoint**: Receives translated content from Dify workflow and stores it as drafts
- **Idempotency Support**: Uses runId to prevent duplicate translations
- **Draft Mode**: All translations are saved as drafts (publishedAt=null) for review

## Installation

### Option 1: Local Development (Recommended for Development)

1. Clone or copy this plugin to your development directory:
   ```bash
   cd /path/to/strapi-dify-translations
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Link to your Strapi project using yalc:
   ```bash
   npm install -g yalc
   yalc publish
   
   # In your Strapi project directory
   cd /path/to/your-strapi-project
   yalc add strapi-dify-translations
   npm install
   ```

### Option 2: npm Install (After Publishing)

```bash
npm install strapi-dify-translations
```

## Configuration

Add the plugin configuration to your Strapi project's `config/plugins.ts`:

```typescript
export default ({ env }) => ({
  'dify-translations': {
    enabled: true,
    config: {
      // Required: Dify workflow endpoint URL
      difyEndpoint: env('DIFY_WORKFLOW_ENDPOINT'),
      
      // Optional: API key for Dify authentication (outgoing requests to Dify)
      difyApiKey: env('DIFY_API_KEY'),
      
      // Recommended: API token for callback authentication (incoming requests from Dify)
      callbackApiToken: env('DIFY_CALLBACK_TOKEN'),
      
      // Optional: Source locale (default: 'en')
      sourceLocale: 'en',
      
      // Optional: Callback base path (default: '/dify-translations/callback')
      callbackBasePath: '/dify-translations/callback',
      
      // Optional: Translatable field types (default: ['string', 'text', 'richtext', 'blocks'])
      translatableFieldTypes: ['string', 'text', 'richtext', 'blocks'],
    },
  },
});
```

Add environment variables to your `.env` file:

```env
DIFY_WORKFLOW_ENDPOINT=https://your-dify-instance.com/v1/workflows/run
DIFY_API_KEY=your-dify-api-key
DIFY_CALLBACK_TOKEN=your-secure-callback-token
```

### Callback Authentication

The callback endpoint is protected by API token authentication. When `callbackApiToken` is configured, all requests to `/api/dify-translations/callback` must include an `Authorization` header:

```
Authorization: Bearer your-secure-callback-token
```

Or simply:

```
Authorization: your-secure-callback-token
```

If no `callbackApiToken` is configured, the endpoint will be open (a warning will be logged).

## API Endpoints

### Admin API (requires authentication)

#### POST `/dify-translations/translate`
Send content to Dify for translation.

**Request Body:**
```json
{
  "documentId": "abc123",
  "contentType": "api::blog-post.blog-post"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Translation request sent for 3 locales"
}
```

#### GET `/dify-translations/config`
Get plugin configuration (without API key).

#### GET `/dify-translations/locales`
Get available locales from i18n plugin.

#### GET `/dify-translations/translatable-fields/:contentType`
Get translatable fields for a content type.

### Content API (public)

#### POST `/api/dify-translations/callback?content_type=api::blog-post.blog-post`
Receive translated content from Dify workflow.

**Request Body:**
```json
{
  "documentId": "abc123",
  "locale": "fr",
  "fields": {
    "title": "Titre traduit",
    "content": "Contenu traduit..."
  },
  "runId": "unique-run-id-for-idempotency"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Translation stored for locale fr"
}
```

## Dify Workflow Integration

### Outgoing Payload (to Dify)

When the user clicks "Translate with Dify", the plugin sends this payload to your Dify workflow:

```json
{
  "document_id": "strapi-document-id",
  "fields": {
    "title": "Original title",
    "content": "Original content...",
    "excerpt": "Original excerpt..."
  },
  "source_locale": "en",
  "target_locales": ["fr", "de", "es"],
  "callback_url": "https://your-strapi.com/api/dify-translations/callback?content_type=api::blog-post.blog-post"
}
```

### Expected Callback Payload (from Dify)

Your Dify workflow should call the callback URL for each translated locale:

```json
{
  "documentId": "strapi-document-id",
  "locale": "fr",
  "fields": {
    "title": "Titre en français",
    "content": "Contenu en français...",
    "excerpt": "Extrait en français..."
  },
  "runId": "unique-workflow-run-id"
}
```

## How It Works

1. **User Action**: User opens a collection type entry in Content Manager and clicks "Translate with Dify"
2. **Field Detection**: Plugin automatically detects all localized translatable fields
3. **Send to Dify**: Plugin sends the source content (default: English) with all target locales to the configured Dify endpoint
4. **Dify Processing**: Your Dify workflow processes the translation and calls the callback URL for each locale
5. **Store Translation**: Plugin receives the callback and stores the translation as a draft using Strapi's Document Service API

## Requirements

- Strapi 5.x
- i18n plugin enabled
- Collection types must have `pluginOptions.i18n.localized: true` enabled
- Fields to translate must have `pluginOptions.i18n.localized: true`

## Development

```bash
# Install dependencies
npm install

# Watch mode (rebuilds on changes)
npm run watch

# Build for production
npm run build

# Verify plugin structure
npm run verify
```

## License

MIT

