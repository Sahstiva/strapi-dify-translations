# Strapi Dify Translations Plugin

A Strapi 5 plugin to translate collection type content using Dify AI workflows.

## Features

- **Translate with Dify Button**: Adds a "Translate with Dify" action button in the Content Manager for collection types
- **Language Selection Dialog**: Interactive dialog with checkboxes to select specific target languages for translation
- **Admin Settings Page**: Configure plugin settings directly from Strapi admin panel (Settings → Dify Translations)
- **Nested Component Fields**: Support for translating fields inside components using dot notation (e.g., `seo.title`, `seo.description`)
- **SSE Streaming Mode**: Uses Server-Sent Events for real-time progress logging from Dify workflows
- **Smart Field Merging**: Translated fields from Dify are merged with untranslated fields from the source locale to keep content consistent
- **Relation Handling**: Intelligently handles relations:
  - Non-localized relations are copied from source
  - Localized relations are only connected if they exist in the target locale
- **Component & Dynamic Zone Support**: Preserves components and dynamic zones when creating translations
- **Callback Endpoint**: Receives translated content from Dify workflow and stores it as drafts
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

### Option 1: Admin Settings Page (Recommended)

After installing the plugin, navigate to **Settings → Dify Translations** in the Strapi admin panel to configure:

| Setting | Description |
|---------|-------------|
| **Dify Endpoint** | The Dify workflow API endpoint URL |
| **Dify API Key** | Your Dify API key for authentication (stored securely, displayed masked) |
| **Callback URL** | Base URL of your Strapi instance (e.g., `https://your-strapi.com`) |
| **Callback Base Path** | API path for the callback endpoint (default: `/dify-translations/callback`) |
| **Dify User** | User identifier sent to Dify workflow (default: `strapi-user`) |
| **Source Locale** | The default source language code (default: `en`) |

Settings configured in the admin panel are stored in the database and take precedence over file-based configuration.

### Option 2: File-based Configuration

Add the plugin configuration to your Strapi project's `config/plugins.ts`:

```typescript
export default ({ env }) => ({
  'dify-translations': {
    enabled: true,
    config: {
      // Dify workflow endpoint URL
      difyEndpoint: env('DIFY_WORKFLOW_ENDPOINT'),
      
      // API key for Dify authentication (outgoing requests to Dify)
      difyApiKey: env('DIFY_API_KEY'),
      
      // Recommended: API token for callback authentication (incoming requests from Dify)
      callbackApiToken: env('DIFY_CALLBACK_TOKEN'),
      
      // Required: Fields to translate (must be configured in file)
      // Supports nested component fields using dot notation (one level only)
      translatableFields: [
        'title', 
        'content', 
        'excerpt', 
        'seo.title',        // Nested field in 'seo' component
        'seo.description'   // Nested field in 'seo' component
      ],
      
      // Source locale (default: 'en')
      sourceLocale: 'en',
      
      // User identifier for Dify requests (default: 'strapi-user')
      difyUser: 'strapi-user',
      
      // Callback URL base (your Strapi instance URL)
      callbackUrl: env('STRAPI_URL', 'http://localhost:1337'),
      
      // Callback base path (default: '/dify-translations/callback')
      callbackBasePath: '/dify-translations/callback',
    },
  },
});
```

Add environment variables to your `.env` file:

```env
STRAPI_URL=https://your-strapi-instance.com
DIFY_WORKFLOW_ENDPOINT=https://your-dify-instance.com/v1/workflows/run
DIFY_API_KEY=your-dify-api-key
DIFY_CALLBACK_TOKEN=your-secure-callback-token
```

**Note:** Settings from the admin panel override file-based configuration. The `translatableFields` and `callbackApiToken` settings can only be configured via the file.

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

### Nested Component Fields

You can translate fields inside components using dot notation. For example, if you have an `seo` component with `title` and `description` fields:

```typescript
translatableFields: [
  'title',           // Regular field
  'content',         // Regular field
  'seo.title',       // Nested: seo component -> title field
  'seo.description', // Nested: seo component -> description field
]
```

**Limitations:**
- Only one level of nesting is supported (e.g., `seo.title` works, but `seo.meta.title` does not)
- The component must exist in the content type schema
- Fields are sent to Dify with their exact dot notation names (e.g., `seo.title`)

## API Endpoints

### Admin API (requires authentication)

#### POST `/dify-translations/translate`
Send content to Dify for translation.

**Request Body:**
```json
{
  "documentId": "abc123",
  "contentType": "api::blog-post.blog-post",
  "targetLocales": ["fr", "es", "de"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `documentId` | string | Yes | The document ID to translate |
| `contentType` | string | Yes | The content type UID (e.g., `api::blog-post.blog-post`) |
| `targetLocales` | string[] | No | Array of target locale codes. If omitted, translates to all available locales except source. |

**Response:**
```json
{
  "success": true,
  "message": "Translation request sent for 3 locales. Results will be delivered via callback."
}
```

#### GET `/dify-translations/config`
Get plugin configuration (without API key).

#### GET `/dify-translations/locales`
Get available locales from i18n plugin.

**Response:**
```json
{
  "locales": [
    { "code": "en", "name": "English" },
    { "code": "fr", "name": "French" },
    { "code": "es", "name": "Spanish" }
  ],
  "sourceLocale": "en"
}
```

#### GET `/dify-translations/translatable-fields`
Get translatable fields from config.

#### GET `/dify-translations/settings`
Get plugin settings (API key is masked for security).

**Response:**
```json
{
  "difyEndpoint": "https://api.dify.ai/v1/workflows/run",
  "difyApiKey": "••••••••",
  "callbackUrl": "https://your-strapi.com",
  "callbackBasePath": "/dify-translations/callback",
  "difyUser": "strapi-user",
  "sourceLocale": "en"
}
```

#### PUT `/dify-translations/settings`
Update plugin settings.

**Request Body:**
```json
{
  "difyEndpoint": "https://api.dify.ai/v1/workflows/run",
  "difyApiKey": "app-xxxxx",
  "callbackUrl": "https://your-strapi.com",
  "callbackBasePath": "/dify-translations/callback",
  "difyUser": "strapi-user",
  "sourceLocale": "en"
}
```

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

When the user clicks "Translate with Dify" and selects target languages, the plugin sends this payload to your Dify workflow:

```json
{
  "inputs": {
    "document_id": "d6x9zn0gqhsd8tghmz46wylm",
    "title": "Blog post for testing translations",
    "content": "Your content here...",
    "seo.title": "SEO Title",
    "seo.description": "SEO Description",
    "source_locale": "en",
    "target_locales": "[\"fr\", \"es\", \"de\"]",
    "callback_url": "https://your-strapi.com/dify-translations/callback?content_type=api::blog-post.blog-post"
  },
  "response_mode": "streaming",
  "user": "strapi-user"
}
```

**Note:** The `callback_url` is constructed from `callbackUrl` + `callbackBasePath` settings. For example:
- `callbackUrl`: `https://your-strapi.com`
- `callbackBasePath`: `/dify-translations/callback`
- Result: `https://your-strapi.com/dify-translations/callback?content_type=...`

**Note:** 
- Fields are placed directly in `inputs` (not wrapped in a `fields` object)
- Nested component fields use dot notation (e.g., `seo.title`, `seo.description`)
- `target_locales` is a stringified JSON array containing only the user-selected languages
- Only fields configured in `translatableFields` that have values are included
- `response_mode` is set to `streaming` for Server-Sent Events (SSE) support
- The plugin logs SSE events (workflow_started, node_started, node_finished, workflow_finished) in real-time

### Expected Callback Payload (from Dify)

Your Dify workflow should call the callback URL for each translated locale:

```json
{
  "document_id": "d6x9zn0gqhsd8tghmz46wylm",
  "locale": "es",
  "fields": {
    "title": "Título traducido",
    "content": "Contenido traducido...",
    "seo.title": "Título SEO traducido",
    "seo.description": "Descripción SEO traducida"
  },
  "metadata": {
    "success": "true",
    "error": ""
  }
}
```

**Note:**
- `document_id` uses underscore (not camelCase)
- Translated fields are wrapped in `fields` object
- Nested fields use the same dot notation as in the request (e.g., `seo.title`)
- `metadata.success` should be `"true"` for successful translations
- `metadata.error` contains error message if translation failed

### Callback Field Merging Behavior

When the callback is received, the plugin intelligently merges content:

| Field Type | Behavior |
|------------|----------|
| **Translated fields** | Applied from Dify response |
| **Untranslated fields** | Copied from source locale |
| **Non-localized relations** | Copied from source locale |
| **Localized relations** | Only connected if related document exists in target locale |
| **Components** | Preserved from existing target locale entry, or copied from source |
| **Dynamic zones** | Preserved from existing target locale entry, or copied from source |

This ensures that translated content is complete and consistent with the source, while avoiding errors from missing related documents.

## How It Works

1. **User Action**: User opens a collection type entry in Content Manager and clicks "Translate with Dify"
2. **Language Selection**: A dialog appears with checkboxes for all available target languages (all selected by default)
3. **Field Detection**: Plugin automatically detects all configured translatable fields from the source locale
4. **Send to Dify**: Plugin sends the source content with selected target locales to the configured Dify endpoint via SSE streaming
5. **Dify Processing**: Your Dify workflow processes the translation and calls the callback URL for each locale
6. **Smart Merging**: Plugin receives the callback and:
   - Applies translated fields from Dify
   - Copies untranslated fields from source locale
   - Handles relations (copies non-localized relations, checks existence for localized relations)
   - Preserves components and dynamic zones
7. **Store Translation**: Translation is saved as a draft using Strapi's Document Service API

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

