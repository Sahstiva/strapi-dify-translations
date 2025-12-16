import { useState, useEffect, useRef } from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Dialog, Flex, Typography, Button, Checkbox, Box, Loader } from '@strapi/design-system';
import { Languages } from 'lucide-react';
import { PLUGIN_ID } from '../pluginId';

interface DocumentActionProps {
  activeTab: 'draft' | 'published' | null;
  collectionType: string;
  document?: any;
  documentId?: string;
  meta?: any;
  model: string;
}

interface Locale {
  code: string;
  name: string;
}

/**
 * Check if an error is an abort error (should be silently ignored)
 */
function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === 'AbortError' ||
      error.message.includes('aborted') ||
      error.message.includes('signal')
    );
  }
  return false;
}

/**
 * Dialog content component to handle state for locale selection
 */
function TranslateDialogContent({
  documentId,
  model,
  onSuccess,
  onError,
}: {
  documentId: string;
  model: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { get, post } = useFetchClient();
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingLocales, setIsLoadingLocales] = useState(true);
  const [locales, setLocales] = useState<Locale[]>([]);
  const [sourceLocale, setSourceLocale] = useState<string>('en');
  const [selectedLocales, setSelectedLocales] = useState<Set<string>>(new Set());
  
  // Track if component is mounted to avoid state updates after unmount
  const isMountedRef = useRef(true);

  // Fetch available locales when dialog opens
  useEffect(() => {
    isMountedRef.current = true;

    const fetchLocales = async () => {
      try {
        const response = await get(`/${PLUGIN_ID}/locales`);
        
        // Check if still mounted before updating state
        if (!isMountedRef.current) return;
        
        const { locales: fetchedLocales, sourceLocale: fetchedSourceLocale } = response.data;
        
        setSourceLocale(fetchedSourceLocale || 'en');
        
        // Filter out the source locale
        const targetLocales = fetchedLocales.filter(
          (locale: Locale) => locale.code !== fetchedSourceLocale
        );
        setLocales(targetLocales);
        
        // Select all locales by default
        setSelectedLocales(new Set(targetLocales.map((l: Locale) => l.code)));
      } catch (error) {
        // Ignore abort errors (component unmounted)
        if (isAbortError(error)) return;
        
        console.error('Failed to fetch locales:', error);
        if (isMountedRef.current) {
          onError('Failed to load available languages');
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoadingLocales(false);
        }
      }
    };

    fetchLocales();

    // Cleanup: mark as unmounted
    return () => {
      isMountedRef.current = false;
    };
  }, [get, onError]);

  const handleLocaleToggle = (localeCode: string) => {
    setSelectedLocales((prev) => {
      const next = new Set(prev);
      if (next.has(localeCode)) {
        next.delete(localeCode);
      } else {
        next.add(localeCode);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedLocales.size === locales.length) {
      // Deselect all
      setSelectedLocales(new Set());
    } else {
      // Select all
      setSelectedLocales(new Set(locales.map((l) => l.code)));
    }
  };

  const handleTranslate = async () => {
    if (selectedLocales.size === 0) {
      onError('Please select at least one language to translate to');
      return;
    }

    setIsLoading(true);
    try {
      const response = await post(`/${PLUGIN_ID}/translate`, {
        documentId,
        contentType: model,
        targetLocales: Array.from(selectedLocales),
      });

      // Check if still mounted before updating state
      if (!isMountedRef.current) return;

      if (response.data?.success) {
        onSuccess(response.data.message || 'Translation request sent successfully');
      } else {
        throw new Error(response.data?.message || 'Translation failed');
      }
    } catch (error: any) {
      // Ignore abort errors (component unmounted or dialog closed)
      if (isAbortError(error)) return;
      
      console.error('Translation error:', error);
      if (isMountedRef.current) {
        onError(
          error?.response?.data?.error?.message ||
            error.message ||
            'Failed to send translation request'
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const allSelected = selectedLocales.size === locales.length && locales.length > 0;
  const noneSelected = selectedLocales.size === 0;

  return (
    <>
      <Dialog.Body>
        <Flex direction="column" gap={4}>
          <Typography textAlign="center">
            Select the languages to translate this content into.
            Translations will be saved as drafts.
          </Typography>

          {isLoadingLocales ? (
            <Flex justifyContent="center" padding={4}>
              <Loader small>Loading languages...</Loader>
            </Flex>
          ) : locales.length === 0 ? (
            <Typography textAlign="center" textColor="warning600">
              No target languages available. Make sure you have configured additional locales in Strapi.
            </Typography>
          ) : (
            <Flex direction="column" alignItems="stretch">
              <Box paddingBottom={3} borderColor="neutral200" borderStyle="solid" borderWidth="0 0 1px 0">
                <Checkbox
                  checked={!noneSelected}
                  onCheckedChange={handleSelectAll}
                >
                  <Typography fontWeight="bold">
                    {allSelected ? 'Deselect all' : 'Select all'} ({locales.length} languages)
                  </Typography>
                </Checkbox>
              </Box>
              <Flex direction="column" alignItems="flex-start" gap={2} paddingTop={3}>
                {locales.map((locale) => (
                  <Checkbox
                    key={locale.code}
                    checked={selectedLocales.has(locale.code)}
                    onCheckedChange={() => handleLocaleToggle(locale.code)}
                  >
                    {locale.name} ({locale.code})
                  </Checkbox>
                ))}
              </Flex>
            </Flex>
          )}

          <Typography textAlign="center" fontWeight="bold" textColor="warning600">
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
            disabled={isLoadingLocales || selectedLocales.size === 0}
          >
            Translate ({selectedLocales.size} {selectedLocales.size === 1 ? 'language' : 'languages'})
          </Button>
        </Dialog.Action>
      </Dialog.Footer>
    </>
  );
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
  const [isLoading, setIsLoading] = useState(false);

  // Only show for collection types
  if (collectionType !== 'collection-types') {
    return null;
  }

  // Document must be saved first
  if (!documentId) {
    return null;
  }

  const handleSuccess = (message: string) => {
    setIsLoading(false);
    toggleNotification({
      type: 'success',
      message,
    });
  };

  const handleError = (message: string) => {
    setIsLoading(false);
    toggleNotification({
      type: 'danger',
      message,
    });
  };

  return {
    type: 'icon' as const,
    icon: <Languages size={16} />,
    disabled: isLoading,
    label: isLoading ? 'Translating...' : 'Translate with Dify',
    dialog: {
      type: 'dialog' as const,
      title: 'Translate with Dify',
      content: (
        <TranslateDialogContent
          documentId={documentId}
          model={model}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      ),
    },
  };
}
