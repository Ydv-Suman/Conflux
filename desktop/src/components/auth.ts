import logoUrl from "../../src-tauri/app-icon.png";

export { logoUrl };
export const projectIconUrl = logoUrl;

export const fieldClass = "grid gap-2 text-xs font-semibold text-[#30342f]";
export const inputClass = `
  h-11 w-full rounded-lg border border-[#c9c9c1] bg-[#fffefa] px-3
  text-sm font-normal text-[#1d211e] outline-none transition duration-200
  placeholder:text-[#969990] hover:border-[#999d96] focus:border-[#66707c]
  focus:ring-3 focus:ring-[#66707c]/15
`;
export const primaryClass = `
  flex min-h-11 cursor-pointer items-center justify-center gap-2.5 rounded-lg
  border border-[#343a42] bg-[#343a42] px-4 font-bold text-white transition
  duration-200 hover:bg-[#484f59] active:translate-y-px focus-visible:outline-3
  focus-visible:outline-offset-3 focus-visible:outline-[#66707c]/25
  disabled:cursor-wait disabled:opacity-65
`;
export const secondaryClass = `
  min-h-11 cursor-pointer rounded-lg border border-[#59616c] bg-transparent
  px-4 font-bold text-[#414851] transition duration-200 hover:bg-[#e8e9e7]
  active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3
  focus-visible:outline-[#66707c]/25
`;

export const brand = () => `
  <aside
    class="flex min-h-[260px] flex-col items-center bg-[#fa7f2d] p-7
      text-center text-[#343a42] md:min-h-dvh md:p-[clamp(30px,5vw,58px)]"
  >
    <div class="my-auto grid justify-items-center gap-10">
      <div class="flex items-center">
        <img class="size-[88px] object-cover" src="${logoUrl}" alt="">
        <span class="-ml-2 text-4xl font-bold tracking-[-.04em] text-white">onflux</span>
      </div>
      <div>
        <h1 class="m-0 text-[clamp(30px,3.5vw,40px)] leading-[1.02] font-bold tracking-[-.05em]">
          Build together,<br>
          without losing<br class="max-md:hidden">
          the thread.
        </h1>
      </div>
    </div>
  </aside>
`;

export const passwordField = (
  name: string,
  autocomplete: string,
  placeholder = '',
) => `
  <span class="relative block">
    <input
      class="${inputClass} pr-12"
      name="${name}"
      type="password"
      autocomplete="${autocomplete}"
      minlength="12"
      maxlength="128"
      placeholder="${placeholder}"
      required
    >
    <button
      class="password-toggle absolute inset-y-0 right-0 grid w-11 cursor-pointer
        place-items-center rounded-lg border-0 bg-transparent text-[#6d716b]
        hover:text-[#414851] focus-visible:outline-3
        focus-visible:-outline-offset-1 focus-visible:outline-[#66707c]/25"
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
