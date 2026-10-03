import { post } from './api';
import { API_URL, LOGIN_PATH, OAUTH_PATH } from './config';
import { loginView } from './views/login';
import { registrationView } from './views/register';
import { checkEmailAction, continueAction, retryAction, statusView } from './views/status';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('App root is missing');

const clean = (value: string) => value.replace(/[&<>"']/g, '');
const setRoute = (path: string) => {
  history.pushState({}, '', path);
  render();
};

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
    setSubmitting(form, true);

    try {
      await post(LOGIN_PATH, Object.fromEntries(new FormData(form)));
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Unable to log in.');
    } finally {
      setSubmitting(form, false);
    }
  });

  document.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach((button) => {
    button.addEventListener('click', () => {
      location.assign(`${API_URL}${OAUTH_PATH}/${button.dataset.provider}`);
    });
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
      showMessage('A new verification link has been sent.', 'success');
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
        ? clean(error.message)
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
    const email = clean(sessionStorage.getItem('verificationEmail') || '');
    app.innerHTML = statusView({
      icon: 'mail',
      title: 'Check your inbox',
      body: email
        ? `We sent a verification link to <strong>${email}</strong>.`
        : 'Enter your email to request a new verification link.',
      action: checkEmailAction(email),
    });
    bindResend();
  } else if (pathname === '/sign-up') {
    app.innerHTML = registrationView();
    bindRegistration();
  } else {
    app.innerHTML = loginView();
    bindLogin();
  }

  bindLinks();
  bindPasswordToggles();
};

export const startApp = () => {
  window.addEventListener('popstate', render);
  render();
};
