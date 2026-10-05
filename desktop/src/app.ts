import { ApiError, post } from './api';
import { getCurrentUser, isAuthenticated, login, logout, restoreSession } from './auth';
import { API_URL, OAUTH_PATH } from './config';
import { loginView } from './views/login';
import { registrationView } from './views/register';
import { checkEmailAction, continueAction, retryAction, statusView } from './views/status';
import { homeView, loadingView, logoutFailedView } from './views/home';
import { escapeHtml } from './html';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('App root is missing');

const setRoute = (path: string) => {
  history.pushState({}, '', path);
  render();
};

let cooldownTimer: number | undefined;

const showMessage = (message: string, type: 'error' | 'success' = 'error') => {
  const output = document.querySelector<HTMLOutputElement>('#form-message');
  if (!output) return;
  output.textContent = message;
  output.classList.remove('hidden');
  if (type === 'success') {
    output.className = `
      border-l-3 border-[#39715b] bg-[#e9f1ec] px-3 py-2
      text-xs leading-relaxed text-[#285442]
    `;
  }
};

const setSubmitting = (form: HTMLFormElement, active: boolean) => {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) return;
  button.disabled = active;
  button.textContent = active ? 'Please wait…' : button.dataset.label || 'Submit';
};

const startCooldown = (form: HTMLFormElement, seconds: number) => {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) return;
  window.clearInterval(cooldownTimer);
  let remaining = Math.max(1, Math.ceil(seconds));
  button.disabled = true;
  const update = () => {
    button.textContent = `Try again in ${remaining}s`;
    remaining -= 1;
    if (remaining < 0) {
      window.clearInterval(cooldownTimer);
      button.disabled = false;
      button.textContent = button.dataset.label || 'Submit';
    }
  };
  update();
  cooldownTimer = window.setInterval(update, 1000);
};

const bindLinks = () => {
  document.querySelectorAll<HTMLAnchorElement>('[data-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setRoute(new URL(link.href).pathname);
    });
  });
};

const bindPasswordToggles = () => {
  document.querySelectorAll<HTMLButtonElement>('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.previousElementSibling as HTMLInputElement;
      const show = input.type === 'password';

      input.type = show ? 'text' : 'password';
      button.ariaLabel = show ? 'Hide password' : 'Show password';
      button.ariaPressed = String(show);
    });
  });
};

const bindRegistration = () => {
  const form = document.querySelector<HTMLFormElement>('#register-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (values.password !== values.confirmPassword) {
      showMessage('Passwords do not match.');
      return;
    }

    setSubmitting(form, true);

    try {
      await post('/api/users', values);
      sessionStorage.setItem('verificationEmail', String(values.email));
      setRoute('/check-email');
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : 'Unable to create your account.',
      );
    } finally {
      setSubmitting(form, false);
    }
  });
};

const bindLogin = () => {
  const form = document.querySelector<HTMLFormElement>('#login-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    let rateLimited = false;
    setSubmitting(form, true);

    try {
      const data = new FormData(form);
      await login(String(data.get('usernameOrEmail')), String(data.get('password')));
      setRoute('/app');
    } catch (error) {
      const password = form.querySelector<HTMLInputElement>('[name="password"]');
      if (password) password.value = '';
      if (error instanceof ApiError && error.status === 429) {
        rateLimited = true;
        showMessage('Too many login attempts. Please wait before trying again.');
        startCooldown(form, error.retryAfter ?? 60);
        return;
      }
      showMessage(
        error instanceof ApiError && error.status === 401
          ? 'Incorrect username/email or password.'
          : error instanceof Error ? error.message : 'Unable to log in.',
      );
    } finally {
      if (!rateLimited) setSubmitting(form, false);
    }
  });

  document.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach((button) => {
    button.addEventListener('click', () => {
      location.assign(`${API_URL}${OAUTH_PATH}/${button.dataset.provider}`);
    });
  });

  document.querySelector<HTMLButtonElement>('#forgot-password')?.addEventListener('click', () => {
    showMessage('Password recovery is not available yet. Contact support if you cannot sign in.');
  });
};

const bindLogout = () => {
  document.querySelectorAll<HTMLButtonElement>('#logout-button, #logout-button-secondary')
    .forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Logging out…';
      try {
        await logout();
        setRoute('/');
      } catch {
        app.innerHTML = logoutFailedView;
        bindLogoutFailure();
      }
    }));
};

const bindLogoutFailure = () => {
  document.querySelector<HTMLButtonElement>('#retry-logout')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = 'Retrying…';
    try {
      await logout();
      setRoute('/');
    } catch {
      button.disabled = false;
      button.textContent = 'Retry logout';
      showMessage('The server is still unavailable. Your server session may remain active.');
    }
  });
  document.querySelector<HTMLButtonElement>('#close-app')?.addEventListener('click', () => {
    window.close();
  });
};

const bindResend = () => {
  const form = document.querySelector<HTMLFormElement>('#resend-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(form, true);

    try {
      await post('/api/users/resend-verification', {
        email: new FormData(form).get('email'),
      });
      showMessage('If the account is eligible, verification instructions will be sent.', 'success');
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : 'Unable to resend the email.',
      );
    } finally {
      setSubmitting(form, false);
    }
  });
};

const verifyEmail = async (token: string) => {
  try {
    await post('/api/users/verify-email', { token });
    app.innerHTML = statusView({
      icon: 'check',
      title: 'Email verified',
      body: 'Your account is ready. You can now log in.',
      action: continueAction,
    });
  } catch (error) {
    app.innerHTML = statusView({
      icon: 'error',
      title: 'Link unavailable',
      body: error instanceof Error
        ? escapeHtml(error.message)
        : 'This verification link is invalid or has expired.',
      action: retryAction,
    });
  }
  bindLinks();
};

const render = () => {
  const { pathname, searchParams } = new URL(location.href);
  if (pathname === '/verify-email') {
    app.innerHTML = statusView({
      icon: 'mail',
      title: 'Verifying your email',
      body: 'Please wait while we confirm your verification link.',
    });
    void verifyEmail(searchParams.get('token') || '');
  } else if (pathname === '/check-email') {
    const email = sessionStorage.getItem('verificationEmail') || '';
    app.innerHTML = statusView({
      icon: 'mail',
      title: 'Check your inbox',
      body: email
        ? `If registration can be completed for <strong>${escapeHtml(email)}</strong>, verification instructions will arrive shortly. If you already have an account, sign in instead.`
        : 'If the account is eligible, verification instructions will be sent.',
      action: checkEmailAction(email),
    });
    bindResend();
  } else if (pathname === '/sign-up') {
    if (isAuthenticated()) {
      setRoute('/app');
      return;
    }
    app.innerHTML = registrationView();
    bindRegistration();
  } else if (pathname === '/app') {
    const user = getCurrentUser();
    if (!user) {
      setRoute('/');
      return;
    }
    app.innerHTML = homeView(user);
    bindLogout();
  } else {
    if (isAuthenticated()) {
      setRoute('/app');
      return;
    }
    app.innerHTML = loginView();
    bindLogin();
  }

  bindLinks();
  bindPasswordToggles();
};

export const startApp = () => {
  window.addEventListener('popstate', render);
  app.innerHTML = loadingView;
  void restoreSession().finally(render);
};
