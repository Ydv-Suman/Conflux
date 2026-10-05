import { logoUrl, primaryClass, secondaryClass } from '../components/auth';
import type { AuthUser } from '../auth';
import { escapeHtml } from '../html';

export const homeView = (user: AuthUser) => `
  <main class="grid min-h-dvh grid-rows-[auto_1fr] bg-[#f8f7f2]">
    <header class="flex items-center justify-between border-b border-[#d8d6ce] px-6 py-4 md:px-10">
      <img class="h-10 w-auto" src="${logoUrl}" alt="Conflux">
      <button class="${secondaryClass} min-h-10 px-5" id="logout-button" type="button">
        Log out
      </button>
    </header>
    <section class="grid place-items-center px-6 py-12">
      <div class="w-full max-w-[680px]">
        <p class="mb-3 font-mono text-[10px] font-bold tracking-[.12em] text-[#39715b]">WORKSPACE</p>
        <h1 class="m-0 text-[clamp(34px,5vw,54px)] leading-none font-bold tracking-[-.05em]">
          Welcome, ${escapeHtml(user.username)}
        </h1>
        <p class="mb-8 mt-4 max-w-[52ch] text-sm leading-relaxed text-[#6d716b]">
          Your session is active. Team collaboration will appear here as the workspace is built.
        </p>
        <button class="${primaryClass} w-36" id="logout-button-secondary" type="button">
          Log out
        </button>
        <output id="form-message" class="mt-4 hidden border-l-3 border-[#a54d45] bg-[#f8eae7] px-3 py-2 text-xs text-[#7f342e]" role="alert"></output>
      </div>
    </section>
  </main>
`;

export const loadingView = `
  <main class="grid min-h-dvh place-items-center bg-[#f8f7f2] px-6" aria-busy="true">
    <div class="w-full max-w-[360px] animate-pulse">
      <div class="h-4 w-24 rounded bg-[#d8d6ce]"></div>
      <div class="mt-5 h-11 w-full rounded bg-[#d8d6ce]"></div>
      <div class="mt-3 h-4 w-4/5 rounded bg-[#e3e1da]"></div>
    </div>
  </main>
`;

export const logoutFailedView = `
  <main class="grid min-h-dvh place-items-center bg-[#f8f7f2] px-6 py-12">
    <section class="w-full max-w-[520px] border-l-3 border-[#a54d45] bg-[#f8eae7] p-8">
      <p class="mb-2 font-mono text-[10px] font-bold tracking-[.12em] text-[#7f342e]">LOGOUT INCOMPLETE</p>
      <h1 class="m-0 text-3xl font-bold tracking-[-.04em] text-[#332522]">We could not confirm logout</h1>
      <p class="mb-7 mt-3 text-sm leading-relaxed text-[#694944]">
        This window no longer has access to your account, but the server session may still be active.
        Retry while connected before leaving this device.
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <button class="${primaryClass}" id="retry-logout" type="button">Retry logout</button>
        <button class="${secondaryClass}" id="close-app" type="button">Close application</button>
      </div>
      <output id="form-message" class="mt-4 hidden text-xs text-[#7f342e]" role="alert"></output>
    </section>
  </main>
`;
