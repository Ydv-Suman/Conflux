import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import logoUrl from '../../../src-tauri/app-icon.png';
import githubIcon from '../../assets/icons/github.svg';
import googleIcon from '../../assets/icons/google.svg';
import { ApiError, post } from '../../api';
import { API_URL, OAUTH_PATH } from '../../config';
import { login } from './session';
import { navigate } from '../../app/navigation';
import { messageFor } from '../../app/messages';
import { fieldClass, inputClass, primaryClass, formValues, NoticeView, SubmitButton, PasswordInput, type Notice } from '../../components/FormControls';

const socialClass = 'flex min-h-12 cursor-pointer items-center justify-center gap-3 rounded-lg border border-[#c9c9c1] bg-[#fffefa] font-semibold text-[#252925] transition duration-200 hover:border-[#8d938b] hover:bg-[#f4f4ee] active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#66707c]/25';
function Brand() {
  return <aside className="flex min-h-[260px] flex-col items-center bg-[#fa7f2d] p-7 text-center text-[#343a42] md:min-h-dvh md:p-[clamp(30px,5vw,58px)]">

    <div className="my-auto grid justify-items-center gap-10">

      <div className="flex items-center">
        <img className="size-[88px] object-cover" src={logoUrl} alt="" />
        <span className="-ml-2 text-4xl font-bold tracking-[-.04em] text-white">onflux</span>
      </div>

      <h1 className="m-0 text-[clamp(30px,3.5vw,40px)] leading-[1.02] font-bold tracking-[-.05em]">Build together,
        <br />without losing
        <br />the thread.
      </h1>

    </div>

  </aside>;
}

function AuthShell({ children }: { children: ReactNode }) {
  return <div className="auth-page grid min-h-dvh bg-[#f8f7f2] md:grid-cols-[minmax(300px,.78fr)_minmax(440px,1.22fr)]">
    <Brand />
    <section className="grid place-items-center px-6 py-10 md:px-[clamp(34px,7vw,90px)] md:py-11">{children}</section>
  </div>;
}

export function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [notice, setNotice] = useState<Notice>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setNotice(null);
    const values = formValues(event.currentTarget);
    try { await login(String(values.usernameOrEmail), String(values.password)); onAuthenticated(); }
    catch (error) { setLoginError(error instanceof ApiError && error.status === 401 ? 'Incorrect username/email or password.' : messageFor(error, 'Unable to log in.')); }
    finally { setBusy(false); }
  };
  return <AuthShell>
    <div className="w-full max-w-[510px]">

      <h2 className="mb-8 text-center text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em] text-[#111317]">Welcome back</h2>

      <form ref={formRef} className="grid gap-4" onSubmit={submit}>
        <label className={fieldClass}>Email address/Username
          <input className={inputClass} name="usernameOrEmail" autoComplete="username" maxLength={100} required />
        </label>
        <label className={fieldClass}>Password
          <PasswordInput name="password" autoComplete="current-password" />
        </label>
        <NoticeView notice={notice} />
        <SubmitButton busy={busy} className="w-40 justify-self-center">Log in
          <span aria-hidden="true">→</span>
        </SubmitButton>
      </form>

      {loginError && <dialog ref={(dialog) => { if (dialog && !dialog.open) dialog.showModal(); }} onCancel={() => setLoginError(null)} aria-labelledby="login-error-title" aria-describedby="login-error-message" className="fixed left-1/2 md:left-[68%] top-[42%] m-0 max-h-[calc(100dvh-2rem)] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-[#c9786f] bg-[#f8f7f2] p-6 text-[#1d211e] shadow-xl backdrop:bg-black/45">
        <h2 id="login-error-title" className="m-0 text-xl font-bold">Unable to log in</h2>
        <p id="login-error-message" className="my-5 text-sm leading-relaxed">{loginError}</p>
        <button autoFocus type="button" className={`${primaryClass} w-full`} onClick={() => { setLoginError(null); formRef.current?.querySelector<HTMLInputElement>('input[name="password"]')?.focus(); }}>Try again</button>
      </dialog>}

      <button className="mt-4 block w-full cursor-pointer border-0 bg-transparent text-center text-xs font-semibold text-[#4f554f] underline underline-offset-3" type="button" onClick={() => setNotice({ message: 'Password recovery is not available yet. Contact support if you cannot sign in.' })}>Forgot password?</button>

      <div className="my-6 flex items-center gap-4 text-[10px] font-bold text-[#858981] uppercase before:h-px before:flex-1 before:bg-[#d3d2cb] after:h-px after:flex-1 after:bg-[#d3d2cb]">or</div>

      <div className="grid gap-3">
        <button className={socialClass} type="button" onClick={() => location.assign(`${API_URL}${OAUTH_PATH}/google`)}>
          <img className="size-5" src={googleIcon} alt="" />Continue with Google
        </button>
        <button className={socialClass} type="button" onClick={() => location.assign(`${API_URL}${OAUTH_PATH}/github`)}>
          <img className="size-5" src={githubIcon} alt="" />Continue with GitHub
        </button>
      </div>

      <p className="mb-0 mt-7 text-center text-sm text-[#6d716b]">New to Conflux?
        <a className="font-bold text-[#414851] underline underline-offset-3" href="/sign-up" onClick={(event) => { event.preventDefault(); navigate('/sign-up'); }}>Sign up</a>
      </p>

    </div>
  </AuthShell>;
}

export function Register() {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = formValues(event.currentTarget);
    if (values.password !== values.confirmPassword) { setNotice({ message: 'Passwords do not match.' }); return; }
    setBusy(true); setNotice(null);
    try { await post('/api/users', values); sessionStorage.setItem('verificationEmail', String(values.email)); navigate('/check-email'); }
    catch (error) { setNotice({ message: messageFor(error, 'Unable to create your account.') }); }
    finally { setBusy(false); }
  };
  return <AuthShell>
    <div className="w-full max-w-[550px]">
      <h2 className="m-0 text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em] text-[#111317]">Create your account</h2>
      <p className="mb-8 mt-3 text-sm text-[#6d716b]">Join Conflux and start building together.</p>
      <form className="grid gap-4" onSubmit={submit}>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className={fieldClass}>First name
            <input className={inputClass} name="firstName" autoComplete="given-name" maxLength={50} required />
          </label>
          <label className={fieldClass}>Middle name
            <input className={inputClass} name="middleName" autoComplete="additional-name" maxLength={50} />
          </label>
          <label className={fieldClass}>Last name
            <input className={inputClass} name="lastName" autoComplete="family-name" maxLength={50} required />
          </label>
        </div>

        <label className={fieldClass}>Username
          <input className={inputClass} name="username" minLength={5} required />
        </label>

        <label className={fieldClass}>Email
          <input className={inputClass} name="email" type="email" required />
        </label>

        <label className={fieldClass}>Password
          <PasswordInput name="password" autoComplete="new-password" />
        </label>

        <label className={fieldClass}>Confirm password
          <PasswordInput name="confirmPassword" autoComplete="new-password" />
        </label>

        <NoticeView notice={notice} />
        <SubmitButton busy={busy} className="w-52 justify-self-center">Create account
          <span aria-hidden="true">→</span>
        </SubmitButton>

      </form>
      <p className="mb-0 mt-7 text-center text-sm text-[#6d716b]">Already have an account?
        <a className="font-bold text-[#414851] underline underline-offset-3" href="/" onClick={(event) => { event.preventDefault(); navigate('/'); }}>Log in</a>
      </p>
    </div>
  </AuthShell>;
}

export function EmailStatus({ verify }: { verify: boolean }) {
  const [notice, setNotice] = useState<Notice>({ message: verify ? 'Verifying your email…' : 'Check your inbox.', kind: 'success' });
  const [busy, setBusy] = useState(false);
  const verification = useRef<{ token: string; request: Promise<void> } | null>(null);
  useEffect(() => {
    if (!verify) return;
    const token = new URL(location.href).searchParams.get('token') || '';
    let active = true;
    // StrictMode replays effects; reuse the request so a link is submitted only once.
    if (verification.current?.token !== token) {
      verification.current = { token, request: post('/api/users/verify-email', { token }) };
    }
    void verification.current.request
      .then(() => { if (active) setNotice({ message: 'Email verified. You can now sign in.', kind: 'success' }); })
      .catch((error) => { if (active) setNotice({ message: messageFor(error, 'This verification link is invalid or expired.') }); });
    return () => { active = false; };
  }, [verify]);
  const resend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true);
    try { await post('/api/users/resend-verification', { email: new FormData(event.currentTarget).get('email') }); setNotice({ message: 'If eligible, verification instructions will be sent.', kind: 'success' }); }
    catch (error) { setNotice({ message: messageFor(error, 'Unable to resend the email.') }); }
    finally { setBusy(false); }
  };
  const failed = verify && notice?.kind !== 'success' && notice?.message !== 'Verifying your email…';
  const complete = verify && notice?.kind === 'success' && notice.message.startsWith('Email verified');
  return <div className="auth-page grid min-h-dvh grid-rows-[auto_1fr_auto] bg-[#efede6] p-[clamp(26px,5vw,52px)]">
    <img className="mx-auto size-16 object-cover" src={logoUrl} alt="Conflux" />
    <section className="w-full max-w-[480px] place-self-center border border-[#d2d0c7] bg-[#faf9f4] p-[clamp(34px,7vw,60px)] text-center shadow-[0_24px_70px_-52px_rgba(27,35,30,.5)]">
      <span className={`mx-auto mb-6 grid size-[72px] place-items-center rounded-full ${failed ? 'bg-[#f3e5e2] text-[#8a3f39]' : 'bg-[#e8e9e7] text-[#414851]'}`} aria-hidden="true">
        <svg className="size-8 fill-none stroke-current stroke-[1.7] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24">{failed ? <><path d="M12 8v5M12 17h.01" /><circle cx="12" cy="12" r="9" /></> : complete ? <path d="m5 12 4 4L19 6" /> : <><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></>}</svg>
      </span>
      <p className="mb-3 font-mono text-[10px] font-bold tracking-[.12em] text-[#59616c]">EMAIL VERIFICATION</p>
      <h1 className="m-0 text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em]">{verify ? complete ? 'Email verified' : failed ? 'Link unavailable' : 'Verifying your email' : 'Check your inbox'}</h1>
      <p className="mx-auto mb-7 mt-4 max-w-[37ch] text-sm leading-relaxed text-[#6d716b]">{notice?.message}</p>
      {!verify ? <form className="grid gap-4 text-left" onSubmit={resend}>
        <label className={fieldClass}>Email
          <input className={inputClass} name="email" type="email" autoComplete="email" defaultValue={sessionStorage.getItem('verificationEmail') || ''} required />
        </label>
        <button className="neutral-button" disabled={busy} type="submit">{busy ? 'Please wait…' : 'Resend email'}</button>
        <button className="text-center text-sm font-semibold text-[#414851] underline underline-offset-3" type="button" onClick={() => navigate('/')}>Continue to login</button>
      </form> : <button className={complete ? `${primaryClass} w-full` : 'neutral-button w-full'} onClick={() => navigate(complete ? '/' : '/check-email')}>{complete ? 'Continue to login →' : 'Request a new link'}</button>}
    </section>
  </div>;
}

