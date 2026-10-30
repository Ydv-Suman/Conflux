import { useState, type ReactNode } from 'react';
export type Notice = { message: string; kind?: 'error' | 'success' } | null;

export const fieldClass = 'form-label grid gap-2 text-xs font-semibold text-[#30342f]';
export const inputClass = 'form-input h-11 w-full rounded-lg border border-[#c9c9c1] bg-[#fffefa] px-3 text-sm font-normal text-[#1d211e] outline-none transition duration-200 placeholder:text-[#969990] hover:border-[#999d96] focus:border-[#66707c] focus:ring-3 focus:ring-[#66707c]/15';
export const primaryClass = 'flex min-h-11 cursor-pointer items-center justify-center gap-2.5 rounded-lg border border-[#343a42] bg-[#343a42] px-4 font-bold text-white transition duration-200 hover:bg-[#484f59] active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#66707c]/25 disabled:cursor-wait disabled:opacity-65';
export const formValues = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));

export function NoticeView({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return <output className={`form-notice border-l-3 px-3 py-2 text-xs ${notice.kind === 'success' ? 'is-success border-[#66707c] bg-[#e8e9e7] text-[#414851]' : 'is-error border-[#a54d45] bg-[#f8eae7] text-[#7f342e]'}`} role="alert">{notice.message}</output>;
}

export function SubmitButton({ busy, children, className = '' }: { busy: boolean; children: ReactNode; className?: string }) {
  return <button className={`${primaryClass} ${className}`} disabled={busy} type="submit">{busy ? 'Please wait…' : children}</button>;
}

export function PasswordInput({ name, autoComplete }: { name: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return <span className="relative block">

    <input className={`${inputClass} pr-12`} name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete} minLength={12} maxLength={128} required />

    <button className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-[#6d716b] hover:text-[#414851] focus-visible:outline-3 focus-visible:-outline-offset-1 focus-visible:outline-[#66707c]/25" type="button" aria-label={`${visible ? 'Hide' : 'Show'} password`} aria-pressed={visible} onClick={() => setVisible(!visible)}>
      <svg className="size-5 fill-none stroke-current stroke-[1.7] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    </button>

  </span>;
}

export function EntityForm({ initial, labels, busy, notice, onSubmit }: { initial?: { name: string; description: string | null }; labels: { name: string; submit: string }; busy: boolean; notice: Notice; onSubmit: (name: string, description: string) => void }) {
  return <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const values = formValues(event.currentTarget); onSubmit(String(values.name), String(values.description ?? '')); }}>
    <label className={fieldClass}>
      {labels.name}
      <input className={inputClass} name="name" defaultValue={initial?.name} required maxLength={100} />
    </label>
    <label className={fieldClass}>Description
      <textarea className={`${inputClass} min-h-24 py-3`} name="description" defaultValue={initial?.description ?? ''} maxLength={500} />
    </label>
    <NoticeView notice={notice} />
    <SubmitButton busy={busy}>{labels.submit}</SubmitButton>
  </form>;
}

