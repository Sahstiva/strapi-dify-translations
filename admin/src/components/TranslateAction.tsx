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

interface ProgressEvent {
  jobId: string;
  type: 'started' | 'node_started' | 'node_finished' | 'completed' | 'error';
  message: string;
  current?: number;
  total?: number;
  nodeName?: string;
  index?: number;
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
 * Start polling for progress updates
 */
function startProgressPolling(
  jobId: string,
  onProgress: (event: ProgressEvent) => void,
  onComplete: (success: boolean, message: string) => void,
  fetchFn: (url: string) => Promise<any>
): () => void {
  let stopped = false;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let lastEventIndex = 0;

  const poll = async () => {
    if (stopped) return;

    try {
      const response = await fetchFn(`/${PLUGIN_ID}/progress/${jobId}?since=${lastEventIndex}`);
      const data = response.data;
      
      if (data.events && Array.isArray(data.events)) {
        for (const event of data.events) {
          lastEventIndex = Math.max(lastEventIndex, (event.index || 0) + 1);
          
          onProgress(event as ProgressEvent);
          
          if (event.type === 'completed') {
            stopped = true;
            if (pollInterval) clearInterval(pollInterval);
            onComplete(true, event.message);
            return;
          } else if (event.type === 'error') {
            stopped = true;
            if (pollInterval) clearInterval(pollInterval);
            onComplete(false, event.message);
            return;
          }
        }
      }
    } catch (err) {
      // Silently ignore polling errors
    }
  };

  // Start polling immediately and then every 1 second
  poll();
  pollInterval = setInterval(poll, 1000);

  // Auto-stop after 5 minutes
  const timeout = setTimeout(() => {
    if (!stopped) {
      stopped = true;
      if (pollInterval) clearInterval(pollInterval);
      onComplete(false, 'Translation timed out');
    }
  }, 5 * 60 * 1000);

  return () => {
    stopped = true;
    if (pollInterval) clearInterval(pollInterval);
    clearTimeout(timeout);
  };
}

/**
 * Dialog content component to handle state for locale selection
 */
function TranslateDialogContent({
  onSubmit,
  onError,
}: {
  onSubmit: (selectedLocales: string[]) => void;
  onError: (message: string) => void;
}) {
  const { get } = useFetchClient();
  const [isLoadingLocales, setIsLoadingLocales] = useState(true);
  const [locales, setLocales] = useState<Locale[]>([]);
  const [sourceLocale, setSourceLocale] = useState<string>('en');
  const [selectedLocales, setSelectedLocales] = useState<Set<string>>(new Set());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    const fetchLocales = async () => {
      try {
        const localesResponse = await get(`/${PLUGIN_ID}/locales`);
        
        if (!isMountedRef.current) return;
        
        const { locales: fetchedLocales, sourceLocale: fetchedSourceLocale } = localesResponse.data;
        
        setSourceLocale(fetchedSourceLocale || 'en');
        
        const targetLocales = fetchedLocales.filter(
          (locale: Locale) => locale.code !== fetchedSourceLocale
        );
        setLocales(targetLocales);
        setSelectedLocales(new Set(targetLocales.map((l: Locale) => l.code)));
      } catch (error) {
        if (isAbortError(error)) return;
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
      setSelectedLocales(new Set());
    } else {
      setSelectedLocales(new Set(locales.map((l) => l.code)));
    }
  };

  const handleTranslate = () => {
    if (selectedLocales.size === 0) {
      onError('Please select at least one language to translate to');
      return;
    }
    onSubmit(Array.from(selectedLocales));
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
 */
export function TranslateWithDifyAction({
  documentId,
  model,
  collectionType,
}: DocumentActionProps) {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [isLoading, setIsLoading] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  if (collectionType !== 'collection-types') {
    return null;
  }

  if (!documentId) {
    return null;
  }

  const handleProgress = (event: ProgressEvent) => {
    if (event.type === 'node_started' && event.nodeName) {
      const progressText = event.total ? ` (${event.current}/${event.total})` : '';
      toggleNotification({
        type: 'info',
        message: `${event.nodeName}${progressText}`,
      });
    } else if (event.type === 'node_finished' && event.message.includes('Saved')) {
      toggleNotification({
        type: 'success',
        message: event.message,
      });
    }
  };

  const handleSubmit = async (selectedLocales: string[]) => {
    setIsLoading(true);

    toggleNotification({
      type: 'info',
      message: 'Translation started...',
    });

    try {
      const response = await post(`/${PLUGIN_ID}/translate`, {
        documentId,
        contentType: model,
        targetLocales: selectedLocales,
      });

      if (response.data?.success) {
        const jobId = response.data.jobId;

        if (jobId) {
          if (unsubscribeRef.current) {
            unsubscribeRef.current();
          }

          unsubscribeRef.current = startProgressPolling(
            jobId,
            handleProgress,
            (success, completionMessage) => {
              setIsLoading(false);
              toggleNotification({
                type: success ? 'success' : 'danger',
                message: completionMessage,
              });
              unsubscribeRef.current = null;
              
              // Refresh the page after successful translation to show updated content
              if (success) {
                setTimeout(() => {
                  window.location.reload();
                }, 1500); // Small delay so user can see the success message
              }
            },
            get
          );
        } else {
          setIsLoading(false);
          toggleNotification({
            type: 'success',
            message: response.data.message || 'Translation request sent successfully',
          });
        }
      } else {
        throw new Error(response.data?.message || 'Translation failed');
      }
    } catch (error: any) {
      setIsLoading(false);
      toggleNotification({
        type: 'danger',
        message: error?.response?.data?.error?.message || error.message || 'Failed to send translation request',
      });
    }
  };

  const handleError = (message: string) => {
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
          onSubmit={handleSubmit}
          onError={handleError}
        />
      ),
    },
  };
}
