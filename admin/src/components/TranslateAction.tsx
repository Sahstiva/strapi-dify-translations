import { useState } from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Dialog, Flex, Typography, Button } from '@strapi/design-system';
import { Earth } from '@strapi/icons';
import { PLUGIN_ID } from '../pluginId';

interface DocumentActionProps {
  activeTab: 'draft' | 'published' | null;
  collectionType: string;
  document?: any;
  documentId?: string;
  meta?: any;
  model: string;
}

/**
 * Header action component for translating content with Dify
 * This is a DescriptionComponent that returns a HeaderActionDescription
 */
export function TranslateWithDifyAction({
  documentId,
  model,
  collectionType,
}: DocumentActionProps) {
  const { toggleNotification } = useNotification();
  const { post } = useFetchClient();
  const [isLoading, setIsLoading] = useState(false);

  // Only show for collection types
  if (collectionType !== 'collection-types') {
    return null;
  }

  // Document must be saved first
  if (!documentId) {
    return null;
  }

  const handleTranslate = async () => {
    setIsLoading(true);
    try {
      const response = await post(`/${PLUGIN_ID}/translate`, {
        documentId,
        contentType: model,
      });

      if (response.data?.success) {
        toggleNotification({
          type: 'success',
          message: response.data.message || 'Translation request sent successfully',
        });
      } else {
        throw new Error(response.data?.message || 'Translation failed');
      }
    } catch (error: any) {
      console.error('Translation error:', error);
      toggleNotification({
        type: 'danger',
        message: error?.response?.data?.error?.message || error.message || 'Failed to send translation request',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    type: 'icon' as const,
    icon: <Earth />,
    disabled: isLoading,
    label: isLoading ? 'Translating...' : 'Translate with Dify',
    dialog: {
      type: 'dialog' as const,
      title: 'Translate with Dify',
      content: (
        <>
          <Dialog.Body>
            <Flex direction="column" gap={3}>
              <Typography textAlign="center">
                This will send the content to Dify for translation into all available locales.
              </Typography>
              <Typography textAlign="center">
                The translations will be saved as drafts.
              </Typography>
              <Typography textAlign="center" fontWeight="bold">
                Note: Make sure you have saved any changes before translating.
              </Typography>
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">Cancel</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button 
                variant="success" 
                onClick={handleTranslate}
                loading={isLoading}
              >
                Translate
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </>
      ),
    },
  };
}
