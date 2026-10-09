import { projectIconUrl } from '../components/auth';
import type { UserProfile } from '../auth';
import { escapeHtml } from '../html';

export const homeView = () => `
  <main class="app-workspace activity-panel-open min-h-dvh bg-[#f8f7f2]" style="--activity-panel-width: 300px">
    <section class="editor-stage m-1 min-h-[calc(100dvh-.5rem)] overflow-hidden rounded-2xl border border-[#d8d6ce] bg-[#f8f7f2] px-4 py-8 sm:px-8 lg:px-12 lg:py-10">
      <div class="mx-auto w-full max-w-[1400px]">
        <div id="team-workspace"></div>
        <output id="form-message" class="mt-4 hidden border-l-3 border-[#a54d45] bg-[#f8eae7] px-3 py-2 text-xs text-[#7f342e]" role="alert"></output>
      </div>
    </section>
    <nav class="activity-rail fixed inset-y-0 left-0 z-20 flex w-12 flex-col items-center border-r border-[#d8d6ce] bg-[#efede6] py-1" aria-label="Primary navigation">
      <img class="mt-1 size-8 rounded-[9px] object-cover" src="${projectIconUrl}" alt="Conflux">
      <div class="mt-auto grid gap-1">
        <button class="rail-button" id="teams-button" type="button" aria-label="Teams" aria-pressed="true" title="Teams">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3.5 19c.5-3.7 2.3-5.5 5.5-5.5s5 1.8 5.5 5.5M14 15c3.8-.5 5.9.8 6.5 4"/></svg>
        </button>
        <button class="rail-button" id="profile-button" type="button" aria-label="Profile" title="Profile">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/><circle cx="12" cy="12" r="10"/></svg>
        </button>
        <button class="rail-button" id="settings-button" type="button" aria-label="Settings" title="Settings">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9.4 4.6 10 2h4l.6 2.6 2.1 1.2 2.5-.8 2 3.5-1.9 1.8v2.4l1.9 1.8-2 3.5-2.5-.8-2.1 1.2L14 21h-4l-.6-2.6-2.1-1.2-2.5.8-2-3.5 1.9-1.8v-2.4L2.8 8.5l2-3.5 2.5.8 2.1-1.2Z"/><circle cx="12" cy="11.5" r="3.25"/></svg>
        </button>
      </div>
    </nav>
    <div class="fixed inset-0 z-30 hidden bg-[#1d211e]/20" id="account-backdrop"></div>
    <aside class="activity-panel fixed bottom-1 left-13 top-1 z-10 overflow-y-auto rounded-2xl border border-[#d8d6ce] bg-[#efede6]" id="profile-popover" aria-label="Activity panel">
      <button class="activity-panel-resizer absolute inset-y-0 right-0 w-1 cursor-col-resize" id="activity-panel-resizer" type="button" aria-label="Resize activity panel" title="Drag to resize"></button>
    </aside>
    <aside class="account-panel fixed left-1/2 top-1/2 z-40 hidden max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-[#d8d6ce] bg-[#f8f7f2] shadow-[0_24px_70px_rgba(39,44,40,.24)]" id="account-panel" aria-label="Team dialog"></aside>
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
  <header class="flex items-center justify-between px-5 pb-3 pt-5">
    <h2 class="m-0 text-lg font-semibold tracking-[-.02em]">Profile</h2>
    <button class="panel-close" type="button" aria-label="Close profile">×</button>
  </header>
  <div class="grid gap-5 px-5 pb-5">
    <section class="rounded-xl bg-[#e8e6df] p-4">
      <div class="flex items-center gap-3.5">
        <div class="grid size-14 shrink-0 place-items-center rounded-full bg-[#4b535d] text-xl font-bold text-white" aria-hidden="true">${escapeHtml(profile.username.charAt(0).toUpperCase())}</div>
        <div class="min-w-0">
          <strong class="block truncate text-base font-semibold tracking-[-.02em]">${escapeHtml(fullName)}</strong>
          <span class="mt-0.5 block truncate text-sm text-[#6d716b]">@${escapeHtml(profile.username)}</span>
        </div>
      </div>
      <p class="mb-0 mt-4 break-all text-sm text-[#59616c]">${escapeHtml(profile.email)}</p>
    </section>

    <button class="neutral-button w-full" data-edit-profile type="button">Edit profile</button>
    <button class="danger-button w-full" id="logout-button" type="button">Log out</button>

    <section class="rounded-xl bg-[#f8eae7] p-4">
      <h3 class="m-0 text-sm font-semibold text-[#7f342e]">Delete account</h3>
      <p class="mb-4 mt-1.5 text-xs leading-relaxed text-[#694944]">Permanently remove your account and profile data.</p>
      <button class="danger-button w-full" id="delete-account" type="button">Delete account</button>
    </section>
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
  <div class="flex justify-end px-4 pt-4"><button class="panel-close" type="button" aria-label="Close panel">×</button></div>
  <div class="grid gap-7 px-7 pb-7 pt-2">
    <div class="grid justify-items-center text-center">
      <div class="grid size-20 place-items-center rounded-full bg-[#4b535d] text-white" aria-hidden="true">
        <svg class="size-9 fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24"><path d="M9.4 4.6 10 2h4l.6 2.6 2.1 1.2 2.5-.8 2 3.5-1.9 1.8v2.4l1.9 1.8-2 3.5-2.5-.8-2.1 1.2L14 21h-4l-.6-2.6-2.1-1.2-2.5.8-2-3.5 1.9-1.8v-2.4L2.8 8.5l2-3.5 2.5.8 2.1-1.2Z"/><circle cx="12" cy="11.5" r="3.25"/></svg>
      </div>
      <strong class="mt-4 text-lg font-semibold tracking-[-.02em]">Settings</strong>
      <span class="mt-1 text-sm text-[#6d716b]">Customize your Conflux experience</span>
    </div>
    <div class="border-t border-[#d8d6ce] pt-5">
      <button class="neutral-button flex w-full items-center justify-center gap-2.5" id="theme-toggle" type="button" aria-label="Toggle color theme">
        <svg class="theme-sun" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
        <svg class="theme-moon" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 15.1A8.5 8.5 0 0 1 8.9 4a8.5 8.5 0 1 0 11.1 11.1Z"/></svg>
        <span class="theme-label">Light mode</span>
      </button>
    </div>
  </div>`;

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
