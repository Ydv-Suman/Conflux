import {
  authShell,
  fieldClass,
  inputClass,
  passwordField,
  primaryClass,
} from "../components/auth";
import githubIcon from "../assets/icons/github.svg";
import googleIcon from "../assets/icons/google.svg";

const socialClass = `
  flex min-h-12 cursor-pointer items-center justify-center gap-3 rounded-lg
  border border-[#c9c9c1] bg-[#fffefa] font-semibold text-[#252925]
  transition duration-200 hover:border-[#8d938b] hover:bg-[#f4f4ee]
  active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3
  focus-visible:outline-[#39715b]/25
`;

export const loginView = () =>
  authShell(`
  <div class="w-full max-w-[510px]">
    <h2 class="mb-8 text-center text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em]" id="login-title">
      Welcome back
    </h2>

    <form class="grid gap-4" id="login-form">
      <label class="${fieldClass}">
        Email address/Username
        <input class="${inputClass}" name="usernameOrEmail" autocomplete="username" maxlength="100" required>
      </label>
      <label class="${fieldClass}">
        Password
        ${passwordField("password", "current-password")}
      </label>
      <output
        id="form-message"
        class="hidden border-l-3 border-[#a54d45] bg-[#f8eae7] px-3 py-2
          text-xs leading-relaxed text-[#7f342e]"
        role="alert"
      ></output>
      <button class="${primaryClass} w-40 justify-self-center" type="submit" data-label="Log in">
        Log in <span aria-hidden="true">→</span>
      </button>
    </form>

    <button
      class="mt-4 block w-full cursor-pointer border-0 bg-transparent text-center text-xs
        font-semibold text-[#4f554f] underline underline-offset-3"
      id="forgot-password"
      type="button"
    >
      Forgot password?
    </button>

    <div
      class="my-6 flex items-center gap-4 text-[10px] font-bold text-[#858981]
        uppercase before:h-px before:flex-1 before:bg-[#d3d2cb] after:h-px
        after:flex-1 after:bg-[#d3d2cb]"
    >
      or
    </div>

    <div class="grid gap-3">
      <button class="${socialClass}" type="button" data-provider="google">
        <img class="size-5" src="${googleIcon}" alt="">
        Continue with Google
      </button>
      <button class="${socialClass}" type="button" data-provider="github">
        <img class="size-5" src="${githubIcon}" alt="">
        Continue with GitHub
      </button>
    </div>

    <p class="mb-0 mt-7 text-center text-sm text-[#6d716b]">
      New to Conflux?
      <a class="font-bold text-[#234a3a] underline underline-offset-3" href="/sign-up" data-link>Sign up</a>
    </p>
  </div>
`);
