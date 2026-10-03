import logoUrl from "../../src-tauri/icons/Conflux-Logo.png";

export { logoUrl };

export const fieldClass = "grid gap-2 text-xs font-semibold text-[#30342f]";
export const inputClass = `
  h-11 w-full rounded-lg border border-[#c9c9c1] bg-[#fffefa] px-3
  text-sm font-normal text-[#1d211e] outline-none transition duration-200
  placeholder:text-[#969990] hover:border-[#999d96] focus:border-[#39715b]
  focus:ring-3 focus:ring-[#39715b]/15
`;
export const primaryClass = `
  flex min-h-11 cursor-pointer items-center justify-center gap-2.5 rounded-lg
  border border-[#18352b] bg-[#18352b] px-4 font-bold text-white transition
  duration-200 hover:bg-[#234a3a] active:translate-y-px focus-visible:outline-3
  focus-visible:outline-offset-3 focus-visible:outline-[#39715b]/25
  disabled:cursor-wait disabled:opacity-65
`;
export const secondaryClass = `
  min-h-11 cursor-pointer rounded-lg border border-[#315f4d] bg-transparent
  px-4 font-bold text-[#234a3a] transition duration-200 hover:bg-[#edf2ed]
  active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3
  focus-visible:outline-[#39715b]/25
`;

export const brand = () => `
  <aside
    class="flex min-h-[260px] flex-col items-center bg-[#18352b] p-7
      text-center text-[#f4f4ec] md:min-h-dvh md:p-[clamp(30px,5vw,58px)]"
  >
    <img class="mt-8 h-14 w-auto md:mt-16" src="${logoUrl}" alt="Conflux">
    <div class="my-12 md:my-auto">
      <h1 class="m-0 text-[clamp(35px,4.2vw,48px)] leading-[.98] font-bold tracking-[-.055em]">
        Build together,<br>
        without losing<br class="max-md:hidden">
        the thread.
      </h1>
    </div>
  </aside>
`;

export const passwordField = (name: string, autocomplete: string) => `
  <span class="relative block">
    <input
      class="${inputClass} pr-12"
      name="${name}"
      type="password"
      autocomplete="${autocomplete}"
      minlength="12"
      maxlength="128"
      required
    >
    <button
      class="password-toggle absolute inset-y-0 right-0 grid w-11 cursor-pointer
        place-items-center rounded-lg border-0 bg-transparent text-[#6d716b]
        hover:text-[#234a3a] focus-visible:outline-3
        focus-visible:-outline-offset-1 focus-visible:outline-[#39715b]/25"
      type="button"
      aria-label="Show password"
      aria-pressed="false"
    >
      <svg
        class="size-5 fill-none stroke-current stroke-[1.7]
          [stroke-linecap:round] [stroke-linejoin:round]"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/>
        <circle cx="12" cy="12" r="2.5"/>
      </svg>
    </button>
  </span>
`;

export const authShell = (content: string) => `
  <div class="grid min-h-dvh bg-[#f8f7f2] md:grid-cols-[minmax(300px,.78fr)_minmax(440px,1.22fr)]">
    ${brand()}
    <section class="grid place-items-center px-6 py-10 md:px-[clamp(34px,7vw,90px)] md:py-11">
      ${content}
    </section>
  </div>
`;
