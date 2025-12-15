import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  Main,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Check } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { PLUGIN_ID } from '../pluginId';

interface SettingsData {
  difyEndpoint: string;
  difyApiKey: string;
  callbackUrl: string;
  callbackBasePath: string;
  difyUser: string;
  sourceLocale: string;
}

const Settings = () => {
  const [settings, setSettings] = useState<SettingsData>({
    difyEndpoint: '',
    difyApiKey: '',
    callbackUrl: '',
    callbackBasePath: '',
    difyUser: '',
    sourceLocale: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const { get, put } = useFetchClient();
  const { toggleNotification } = useNotification();

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await get(`/${PLUGIN_ID}/settings`);
        setSettings({
          difyEndpoint: data.difyEndpoint || '',
          difyApiKey: data.difyApiKey || '',
          callbackUrl: data.callbackUrl || '',
          callbackBasePath: data.callbackBasePath || '',
          difyUser: data.difyUser || '',
          sourceLocale: data.sourceLocale || '',
        });
      } catch (error) {
        toggleNotification({
          type: 'danger',
          message: 'Failed to load settings',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, [get, toggleNotification]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      await put(`/${PLUGIN_ID}/settings`, settings);
      toggleNotification({
        type: 'success',
        message: 'Settings saved successfully',
      });
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: 'Failed to save settings',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: keyof SettingsData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSettings((prev) => ({
      ...prev,
      [field]: e.target.value,
    }));
  };

  if (isLoading) {
    return (
      <Main>
        <Box padding={8}>
          <Typography>Loading...</Typography>
        </Box>
      </Main>
    );
  }

  return (
    <Main>
      <Box padding={8} background="neutral100">
        <form onSubmit={handleSubmit}>
          <Flex direction="column" alignItems="stretch" gap={6}>
            <Flex justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="alpha" tag="h1">
                  Dify Translations Settings
                </Typography>
                <Typography variant="epsilon" textColor="neutral600">
                  Configure your Dify AI workflow integration for translations
                </Typography>
              </Box>
              <Button
                type="submit"
                startIcon={<Check />}
                loading={isSaving}
                disabled={isSaving}
              >
                Save
              </Button>
            </Flex>

            <Box
              background="neutral0"
              padding={6}
              shadow="filterShadow"
              hasRadius
            >
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Typography variant="delta" tag="h2">
                  Dify Configuration
                </Typography>

                <Grid.Root gap={4}>
                  <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                    <Field.Root>
                      <Field.Label>Dify Endpoint</Field.Label>
                      <TextInput
                        name="difyEndpoint"
                        placeholder="https://api.dify.ai/v1/workflows/run"
                        value={settings.difyEndpoint}
                        onChange={handleChange('difyEndpoint')}
                      />
                      <Field.Hint>The Dify workflow API endpoint URL</Field.Hint>
                    </Field.Root>
                  </Grid.Item>

                  <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                    <Field.Root>
                      <Field.Label>Dify API Key</Field.Label>
                      <TextInput
                        name="difyApiKey"
                        type="password"
                        placeholder="app-xxxxxxxxxxxxxxxx"
                        value={settings.difyApiKey}
                        onChange={handleChange('difyApiKey')}
                      />
                      <Field.Hint>Your Dify API key for authentication</Field.Hint>
                    </Field.Root>
                  </Grid.Item>

                  <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                    <Field.Root>
                      <Field.Label>Dify User</Field.Label>
                      <TextInput
                        name="difyUser"
                        placeholder="strapi-user"
                        value={settings.difyUser}
                        onChange={handleChange('difyUser')}
                      />
                      <Field.Hint>User identifier sent to Dify workflow</Field.Hint>
                    </Field.Root>
                  </Grid.Item>

                  <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                    <Field.Root>
                      <Field.Label>Source Locale</Field.Label>
                      <TextInput
                        name="sourceLocale"
                        placeholder="en"
                        value={settings.sourceLocale}
                        onChange={handleChange('sourceLocale')}
                      />
                      <Field.Hint>The default source language code (e.g., en, de, fr)</Field.Hint>
                    </Field.Root>
                  </Grid.Item>

                  <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                    <Field.Root>
                      <Field.Label>Callback URL</Field.Label>
                      <TextInput
                        name="callbackUrl"
                        placeholder="https://your-strapi-url.com/api/dify-translations/callback"
                        value={settings.callbackUrl}
                        onChange={handleChange('callbackUrl')}
                      />
                      <Field.Hint>
                        Full URL where Dify sends translations (overrides base path)
                      </Field.Hint>
                    </Field.Root>
                  </Grid.Item>

                  <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                    <Field.Root>
                      <Field.Label>Callback Base Path</Field.Label>
                      <TextInput
                        name="callbackBasePath"
                        placeholder="/dify-translations/callback"
                        value={settings.callbackBasePath}
                        onChange={handleChange('callbackBasePath')}
                      />
                      <Field.Hint>
                        API path for callback (used if Callback URL is empty)
                      </Field.Hint>
                    </Field.Root>
                  </Grid.Item>
                </Grid.Root>
              </Flex>
            </Box>
          </Flex>
        </form>
      </Box>
    </Main>
  );
};

export default Settings;
