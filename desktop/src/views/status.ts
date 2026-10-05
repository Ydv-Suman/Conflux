import {
  fieldClass,
  inputClass,
  logoUrl,
  primaryClass,
  secondaryClass,
} from "../components/auth";
import { escapeHtml } from '../html';

type StatusOptions = {
  icon: "mail" | "check" | "error";
  title: string;
  body: string;
  action?: string;
};

const icon = (kind: StatusOptions["icon"]) => {
  const paths = {
    mail: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    error: '<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>',
  };
  const color =
    kind === "error"
      ? "bg-[#f3e5e2] text-[#8a3f39]"
      : "bg-[#e1e9df] text-[#234a3a]";

  return `
    <span class="mx-auto mb-6 grid size-[72px] place-items-center rounded-full ${color}" aria-hidden="true">
      <svg
        class="size-8 fill-none stroke-current stroke-[1.7]
          [stroke-linecap:round] [stroke-linejoin:round]"
        viewBox="0 0 24 24"
      >
        ${paths[kind]}
      </svg>
    </span>
  `;
};

export const statusView = (options: StatusOptions) => `
  <div class="grid min-h-dvh grid-rows-[auto_1fr_auto] bg-[#efede6] p-[clamp(26px,5vw,52px)]">
    <img class="mx-auto h-14 w-auto brightness-0" src="${logoUrl}" alt="Conflux">
    <section
      class="w-full max-w-[480px] place-self-center border border-[#d2d0c7]
        bg-[#faf9f4] p-[clamp(34px,7vw,60px)] text-center
        shadow-[0_24px_70px_-52px_rgba(27,35,30,.5)]"
    >
      ${icon(options.icon)}
      <p class="mb-3 font-mono text-[10px] font-bold tracking-[.12em] text-[#39715b]">EMAIL VERIFICATION</p>
      <h1 class="m-0 text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em]">${options.title}</h1>
      <p class="mx-auto mb-7 mt-4 max-w-[37ch] text-sm leading-relaxed text-[#6d716b]">${options.body}</p>
      ${options.action ?? ""}
      <output
        id="form-message"
        class="hidden border-l-3 border-[#a54d45] bg-[#f8eae7] px-3 py-2
          text-xs leading-relaxed text-[#7f342e]"
        role="status"
      ></output>
    </section>
  </div>
`;

export const checkEmailAction = (email: string) => `
  <form id="resend-form" class="grid gap-4 text-left">
    <label class="${fieldClass}">
      Email
      <input class="${inputClass}" name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" required>
    </label>
    <button class="${secondaryClass}" type="submit" data-label="Resend email">Resend email</button>
    <a
      class="text-center text-sm font-semibold text-[#234a3a] underline underline-offset-3"
      href="/"
      data-link
    >
      Continue to login
    </a>
  </form>
`;

export const continueAction = `
  <a class="${primaryClass} no-underline" href="/" data-link>
    Continue to login <span aria-hidden="true">→</span>
  </a>
`;

export const retryAction = `
  <a class="${secondaryClass} flex items-center justify-center no-underline" href="/check-email" data-link>
    Request a new link
  </a>
`;
