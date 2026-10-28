/** Debounced local writes, serialized so an older save cannot finish after a newer one. */
export function createAutoSave(options: {
  initialContent: string;
  getContent: () => string;
  write: (content: string, previousContent: string) => Promise<void>;
  onSaved: (content: string) => void;
  onError: (error: unknown) => void;
  onSaving: (saving: boolean) => void;
  delay?: number;
}) {
  let saved = options.initialContent;
  let ready = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  const cancelTimer = () => { clearTimeout(timer); timer = undefined; };
  const changed = () => {
    cancelTimer();
    if (!disposed && ready && options.getContent() !== saved) timer = setTimeout((): void => { void flush(); }, options.delay ?? 600);
  };
  const flush = async (): Promise<void> => {
    cancelTimer();
    if (disposed || !ready) return;
    if (running) { await running; return flush(); }
    const content = options.getContent();
    if (content === saved) return;
    options.onSaving(true);
    let succeeded = false;
    running = (async () => {
      try {
        await options.write(content, saved);
        saved = content; succeeded = true;
        if (!disposed) options.onSaved(content);
      } catch (error) { if (!disposed) options.onError(error); }
    })();
    await running;
    running = undefined;
    if (!disposed) {
      options.onSaving(false);
      // A failed write stays dirty. Retry on a subsequent edit or explicit save,
      // rather than continuously retrying a full disk or unavailable repository.
      if (succeeded && options.getContent() !== saved) changed();
      else cancelTimer();
    }
  };
  return {
    changed, flush,
    setReady(value: boolean) { if (ready !== value) { ready = value; changed(); } },
    dispose() { disposed = true; cancelTimer(); },
  };
}
