import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ title, children, onClose, compact = false }: { title: string; children: ReactNode; onClose: () => void; compact?: boolean }) {
  const surface = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = surface.current;
    (element?.querySelector<HTMLElement>('input, button, select, textarea') ?? element)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab' || !element) return;
      const controls = [...element.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    element?.addEventListener('keydown', handleKey);
    return () => { element?.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#111]/45 p-5" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={surface} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`modal-surface ${compact ? 'modal-compact' : ''} max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-[#d8d6ce] bg-[#f8f7f2] shadow-[0_24px_70px_rgba(39,44,40,.24)]`}>
      <header className="flex items-center justify-between border-b border-[#d8d6ce] px-7 py-6">
        <h2 className="m-0 text-3xl font-bold tracking-[-.04em]">{title}</h2>
        <button className="panel-close" type="button" aria-label={`Close ${title}`} onClick={onClose}>×</button>
      </header>
      <div className="p-7">{children}</div>
    </section>
  </div>;
}

