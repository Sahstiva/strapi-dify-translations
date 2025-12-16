# Strapi Dify Translations Plugin

A Strapi 5 plugin to translate collection type content using Dify AI workflows.

## Features

- **Translate with Dify Button**: Adds a "Translate with Dify" action button in the Content Manager for collection types
- **Language Selection Dialog**: Interactive dialog with checkboxes to select specific target languages for translation
- **Real-time Progress Notifications**: Toast notifications showing translation progress as the Dify workflow executes
- **Auto-refresh**: Page automatically refreshes when translation completes so you can see the results immediately
- **Admin Settings Page**: Configure plugin settings directly from Strapi admin panel (Settings → Dify Translations)
- **Nested Component Fields**: Support for translating fields inside components using dot notation (e.g., `seo.title`, `seo.description`)
- **SSE Streaming**: Processes Dify's Server-Sent Events for real-time workflow status tracking
- **Smart Field Merging**: Translated fields from Dify are merged with untranslated fields from the source locale
- **Relation Handling**: Intelligently handles relations:
  - Non-localized relations are copied from source
  - Localized relations are only connected if they exist in the target locale
- **Component & Dynamic Zone Support**: Preserves components and dynamic zones when creating translations
- **Callback Endpoint**: Receives translated content from Dify workflow and stores it as drafts
- **Draft Mode**: All translations are saved as drafts (publishedAt=null) for review

## Installation

### Option 1: npm Install

```bash
npm install strapi-dify-translations
```

### Option 2: Local Development

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
- Fields are sent to Dify with underscore notation (e.g., `seo.title` in config becomes `seo_title` in Dify)

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
  "message": "Translation request sent for 3 locale(s)",
  "jobId": "job_1234567890_abc123"
}
```

#### GET `/dify-translations/progress/:jobId`
Get progress events for a translation job (used internally for progress notifications).

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

#### PUT `/dify-translations/settings`
Update plugin settings.

### Content API (public)

#### POST `/api/dify-translations/callback?content_type=api::blog-post.blog-post`
Receive translated content from Dify workflow.

**Request Body:**
```json
{
  "document_id": "abc123",
  "locale": "fr",
  "fields": {
    "title": "Titre traduit",
    "content": "Contenu traduit...",
    "seo_title": "Titre SEO traduit",
    "seo_description": "Description SEO traduite"
  },
  "metadata": {
    "success": "true",
    "error": ""
  }
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
    "seo_title": "SEO Title",
    "seo_description": "SEO Description",
    "source_locale": "en",
    "target_locales": "[\"fr\", \"es\", \"de\"]",
    "callback_url": "https://your-strapi.com/dify-translations/callback?content_type=api::blog-post.blog-post"
  },
  "response_mode": "streaming",
  "user": "strapi-user"
}
```

**Notes:**
- The `callback_url` is constructed from `callbackUrl` + `callbackBasePath` settings
- Nested component fields use underscore notation for Dify compatibility (e.g., `seo.title` in config becomes `seo_title` in Dify)
- `target_locales` is a stringified JSON array containing only the user-selected languages
- Only fields configured in `translatableFields` that have values are included
- `response_mode` is set to `streaming` for Server-Sent Events (SSE) support

### Expected Callback Payload (from Dify)

Your Dify workflow should call the callback URL for each translated locale:

```json
{
  "document_id": "d6x9zn0gqhsd8tghmz46wylm",
  "locale": "es",
  "fields": {
    "title": "Título traducido",
    "content": "Contenido traducido...",
    "seo_title": "Título SEO traducido",
    "seo_description": "Descripción SEO traducida"
  },
  "metadata": {
    "success": "true",
    "error": ""
  }
}
```

**Notes:**
- `document_id` uses underscore (not camelCase)
- Translated fields are wrapped in `fields` object
- Nested fields use underscore notation (e.g., `seo_title` instead of `seo.title`)
- `metadata.success` should be `"true"` for successful translations

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

## How It Works

1. **User Action**: User opens a collection type entry in Content Manager and clicks "Translate with Dify"
2. **Language Selection**: A dialog appears with checkboxes for all available target languages (all selected by default)
3. **Send to Dify**: Plugin sends the source content to Dify via SSE streaming
4. **Progress Updates**: Toast notifications show the progress of the Dify workflow in real-time
5. **Dify Processing**: Your Dify workflow translates the content and calls the callback URL for each locale
6. **Smart Merging**: Plugin receives callbacks and merges translated fields with existing content
7. **Auto-refresh**: Page automatically refreshes when complete so you can see the translated content
8. **Store Translation**: Translations are saved as drafts using Strapi's Document Service API

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
