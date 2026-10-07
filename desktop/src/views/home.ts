import { projectIconUrl } from '../components/auth';
import type { AuthUser, UserProfile } from '../auth';
import { escapeHtml } from '../html';

export const homeView = (user: AuthUser) => `
  <main class="app-workspace grid min-h-dvh bg-[#f8f7f2] pl-12">
    <section class="grid place-items-center px-6 py-12">
      <div class="w-full max-w-[680px]">
        <p class="mb-3 font-mono text-[10px] font-bold tracking-[.12em] text-[#59616c]">WORKSPACE</p>
        <h1 class="m-0 text-[clamp(34px,5vw,54px)] leading-none font-bold tracking-[-.05em]">
          Welcome, ${escapeHtml(user.username)}
        </h1>
        <p class="mb-8 mt-4 max-w-[52ch] text-sm leading-relaxed text-[#6d716b]">
          Your session is active. Team collaboration will appear here as the workspace is built.
        </p>
        <output id="form-message" class="mt-4 hidden border-l-3 border-[#a54d45] bg-[#f8eae7] px-3 py-2 text-xs text-[#7f342e]" role="alert"></output>
      </div>
    </section>
    <nav class="activity-rail fixed inset-y-0 left-0 z-20 flex w-12 flex-col items-center border-r border-[#d8d6ce] bg-[#efede6] py-1" aria-label="Account controls">
      <img class="mt-1 size-8 rounded-[9px] object-cover" src="${projectIconUrl}" alt="Conflux">
      <div class="mt-auto grid gap-1">
        <button class="rail-button" id="settings-button" type="button" aria-label="Settings" title="Settings">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9.4 4.6 10 2h4l.6 2.6 2.1 1.2 2.5-.8 2 3.5-1.9 1.8v2.4l1.9 1.8-2 3.5-2.5-.8-2.1 1.2L14 21h-4l-.6-2.6-2.1-1.2-2.5.8-2-3.5 1.9-1.8v-2.4L2.8 8.5l2-3.5 2.5.8 2.1-1.2Z"/><circle cx="12" cy="11.5" r="3.25"/></svg>
        </button>
        <button class="rail-button" id="profile-button" type="button" aria-label="Profile" title="Profile">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/><circle cx="12" cy="12" r="10"/></svg>
        </button>
      </div>
    </nav>
    <div class="fixed inset-0 z-30 hidden bg-[#1d211e]/20" id="account-backdrop"></div>
    <aside class="account-panel fixed bottom-2 left-13 z-40 hidden max-h-[calc(100dvh-1rem)] w-[min(360px,calc(100vw-3.75rem))] overflow-y-auto rounded-2xl border border-[#d8d6ce] bg-[#f8f7f2] shadow-[12px_12px_42px_rgba(39,44,40,.16)]" id="profile-popover" aria-label="Profile"></aside>
    <aside class="account-panel fixed inset-y-0 left-12 z-40 hidden w-[min(430px,calc(100vw-3rem))] overflow-y-auto border-r border-[#d8d6ce] bg-[#f8f7f2] shadow-[18px_0_48px_rgba(39,44,40,.12)]" id="account-panel" aria-label="Account panel"></aside>
  </main>
`;

const panelHeader = (eyebrow: string, title: string) => `
  <header class="flex items-start justify-between border-b border-[#d8d6ce] px-7 pb-6 pt-8">
    <div><p class="mb-2 font-mono text-[10px] font-bold tracking-[.12em] text-[#59616c]">${eyebrow}</p><h2 class="m-0 text-3xl font-bold tracking-[-.04em]">${title}</h2></div>
    <button class="panel-close" type="button" aria-label="Close panel">×</button>
  </header>`;

export const profileLoadingView = `${panelHeader('ACCOUNT', 'Your profile')}<div class="animate-pulse p-7"><div class="h-10 bg-[#e3e1da]"></div><div class="mt-5 h-40 bg-[#e3e1da]"></div></div>`;

export const profileView = (profile: UserProfile) => {
  const fullName = [profile.firstName, profile.middleName, profile.lastName]
    .filter(Boolean)
    .join(' ');

  return `
  <div class="flex justify-end px-4 pt-4"><button class="panel-close" type="button" aria-label="Close panel">×</button></div>
  <div class="grid gap-7 px-7 pb-7 pt-2">
    <div class="grid justify-items-center text-center">
      <div class="grid size-20 place-items-center rounded-full bg-[#4b535d] text-3xl font-bold text-white" aria-hidden="true">${escapeHtml(profile.username.charAt(0).toUpperCase())}</div>
      <div class="mt-4 flex items-center gap-1.5"><strong class="text-lg font-semibold tracking-[-.02em]">@${escapeHtml(profile.username)}</strong><button class="inline-edit" data-edit-profile type="button" aria-label="Edit username"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></svg></button></div>
      <div class="mt-1 flex items-center gap-1.5"><span class="text-sm text-[#6d716b]">${escapeHtml(fullName)}</span><button class="inline-edit" data-edit-profile type="button" aria-label="Edit name"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></svg></button></div>
      <span class="mt-3 text-sm text-[#6d716b]">${escapeHtml(profile.email)}</span>
    </div>
    <div class="grid grid-cols-2 gap-3 border-t border-[#d8d6ce] pt-5">
      <button class="neutral-button" id="logout-button" type="button">Log out</button>
      <button class="min-h-11 border border-[#a54d45] px-4 text-sm font-semibold text-[#7f342e] transition hover:bg-[#f8eae7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a54d45]" id="delete-account" type="button">Delete account</button>
    </div>
  </div>`;
};

export const editProfileView = (profile: UserProfile) => `
  ${panelHeader('ACCOUNT', 'Edit profile')}
  <form class="grid gap-5 p-7" id="profile-form">
    <div class="grid grid-cols-2 gap-4">
      <label class="field-label">First name<input class="field-input" name="firstName" required maxlength="50" value="${escapeHtml(profile.firstName)}"></label>
      <label class="field-label">Last name<input class="field-input" name="lastName" required maxlength="50" value="${escapeHtml(profile.lastName)}"></label>
    </div>
    <label class="field-label">Middle name <span>(optional)</span><input class="field-input" name="middleName" maxlength="50" value="${escapeHtml(profile.middleName ?? '')}"></label>
    <label class="field-label">Username<input class="field-input" name="username" required minlength="5" maxlength="50" pattern="[a-zA-Z0-9._-]+" value="${escapeHtml(profile.username)}"></label>
    <label class="field-label">Email<input class="field-input bg-[#efede6] text-[#777b75]" value="${escapeHtml(profile.email)}" disabled></label>
    <div class="flex items-center justify-between border-t border-[#d8d6ce] pt-5 text-xs text-[#6d716b]"><span>${profile.emailVerified ? 'Email verified' : 'Email not verified'}</span><span>Joined ${new Date(profile.createdAt).toLocaleDateString()}</span></div>
    <div class="grid grid-cols-2 gap-3"><button class="neutral-button" id="cancel-profile-edit" type="button">Cancel</button><button class="neutral-button-filled" data-label="Save changes" type="submit">Save changes</button></div>
    <output id="form-message" class="hidden border-l-3 border-[#a54d45] bg-[#f8eae7] px-3 py-2 text-xs text-[#7f342e]" role="alert"></output>
  </form>`;

export const settingsView = `
  <header class="flex items-start justify-between border-b border-[#d8d6ce] px-7 pb-6 pt-8">
    <h2 class="m-0 text-3xl font-bold tracking-[-.04em]">Settings</h2>
    <div class="flex gap-2">
      <button class="panel-action" id="theme-toggle" type="button" aria-label="Toggle color theme" title="Toggle color theme">
        <svg class="theme-sun" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
        <svg class="theme-moon" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 15.1A8.5 8.5 0 0 1 8.9 4a8.5 8.5 0 1 0 11.1 11.1Z"/></svg>
      </button>
      <button class="panel-close" type="button" aria-label="Close panel">×</button>
    </div>
  </header>`;

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
        <button class="neutral-button-filled" id="retry-logout" type="button">Retry logout</button>
        <button class="neutral-button" id="close-app" type="button">Close application</button>
      </div>
      <output id="form-message" class="mt-4 hidden text-xs text-[#7f342e]" role="alert"></output>
    </section>
  </main>
`;
