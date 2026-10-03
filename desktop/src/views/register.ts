import {
  authShell,
  fieldClass,
  inputClass,
  passwordField,
  primaryClass,
} from '../components/auth';

export const registrationView = () => authShell(`
  <div class="w-full max-w-[550px]">
    <h2 class="m-0 text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em]" id="register-title">
      Create your account
    </h2>
    <p class="mb-8 mt-3 text-sm text-[#6d716b]">Join Conflux and start building together.</p>

    <form class="grid gap-4" id="register-form">
      <div class="grid gap-4 sm:grid-cols-3">
        <label class="${fieldClass}">
          First name
          <input class="${inputClass}" name="firstName" autocomplete="given-name" maxlength="50" required>
        </label>
        <label class="${fieldClass}">
          Middle name
          <input class="${inputClass}" name="middleName" autocomplete="additional-name" maxlength="50">
        </label>
        <label class="${fieldClass}">
          Last name
          <input class="${inputClass}" name="lastName" autocomplete="family-name" maxlength="50" required>
        </label>
      </div>

      <label class="${fieldClass}">
        Username
        <input
          class="${inputClass}"
          name="username"
          autocomplete="username"
          minlength="5"
          maxlength="50"
          pattern="[A-Za-z0-9._-]+"
          required
        >
      </label>
      <label class="${fieldClass}">
        Email
        <input class="${inputClass}" name="email" type="email" autocomplete="email" maxlength="100" required>
      </label>
      <label class="${fieldClass}">
        Password
        ${passwordField('password', 'new-password', 'Use at least 12 characters')}
      </label>
      <label class="${fieldClass}">
        Confirm password
        ${passwordField('confirmPassword', 'new-password', 'Re-enter your password')}
      </label>

      <output
        id="form-message"
        class="hidden border-l-3 border-[#a54d45] bg-[#f8eae7] px-3 py-2
          text-xs leading-relaxed text-[#7f342e]"
        role="alert"
      ></output>
      <button class="${primaryClass} w-52 justify-self-center" type="submit" data-label="Create account">
        Create account <span aria-hidden="true">→</span>
      </button>
    </form>

    <p class="mb-0 mt-7 text-center text-sm text-[#6d716b]">
      Already have an account?
      <a class="font-bold text-[#234a3a] underline underline-offset-3" href="/" data-link>Log in</a>
    </p>
  </div>
`);
