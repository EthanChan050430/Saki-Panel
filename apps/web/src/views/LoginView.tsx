import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Coins,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  LogIn,
  SendHorizontal,
  Sparkles,
  UserCheck,
  UserPlus
} from "lucide-react";
import type { CurrentUser, PanelAppearanceSettings, RegisterRequest, RegistrationIdentity } from "@webops/shared";
import { api, ApiError } from "../api.js";
import { sakiArtAssets, tokenKey } from "../constants.js";
import { useSkinRevision } from "../plugins/SkinLoader.js";
import { panelLanguageOptions, type PanelLanguage, usePanelLanguage, usePanelT } from "../i18n/index.js";
import {
  clearRememberedLogin,
  readRememberedLogin,
  saveRememberedLogin,
  setManualLogoutSuppressed
} from "../utils/auth.js";
import { ThemeMorphIcon } from "../components/common/ThemeMorphIcon.js";
import { AccountAvatar } from "../components/common/AccountAvatar.js";
import { LiquidGlassContainer } from "../components/common/LiquidGlass.js";

export type AuthMode = "login" | "register";

interface VerifiedUserSummary {
  username: string;
  displayName: string | null;
  avatarDataUrl: string | null;
}

function LangDropdown({
  language,
  setLanguage
}: {
  language: PanelLanguage;
  setLanguage: (lang: PanelLanguage) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={wrapRef} className={`login-lang-dropdown${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="login-lang-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="Select language"
        aria-expanded={open}
      >
        <Globe size={15} />
      </button>
      {open && (
        <ul className="login-lang-menu" role="listbox">
          {panelLanguageOptions.map((opt) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={language === opt.value}
              className={`login-lang-option${language === opt.value ? " is-active" : ""}`}
              onClick={() => { setLanguage(opt.value); setOpen(false); }}
            >
              {language === opt.value && <Check size={12} className="login-lang-check" />}
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LoginView({
  appearance,
  onLogin,
  darkMode,
  themeSwitching = false,
  onToggleDarkMode
}: {
  appearance: PanelAppearanceSettings;
  onLogin: (token: string, user: CurrentUser) => void;
  darkMode: boolean;
  themeSwitching?: boolean;
  onToggleDarkMode: (e?: React.MouseEvent<HTMLElement>) => void;
}) {
  useSkinRevision();
  const t = usePanelT();
  const { language, setLanguage } = usePanelLanguage();
  const rememberedLogin = useMemo(() => readRememberedLogin(), []);
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState(rememberedLogin?.username ?? "admin");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState(rememberedLogin?.password ?? "");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberLogin, setRememberLogin] = useState(Boolean(rememberedLogin?.username));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const isRegister = mode === "register";

  const [verifiedUser, setVerifiedUser] = useState<VerifiedUserSummary | null>(null);
  const [checkingUser, setCheckingUser] = useState(false);
  const mobilePasswordRef = useRef<HTMLInputElement>(null);

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setError("");
    setPassword(nextMode === "login" ? (rememberedLogin?.password ?? "") : "");
    setConfirmPassword("");
    setVerifiedUser(null);
    if (nextMode === "register") {
      setUsername("");
      setDisplayName("");
      return;
    }
    setUsername(rememberedLogin?.username ?? "admin");
    setDisplayName("");
  }

  function handleResetVerifiedUser() {
    setVerifiedUser(null);
    setPassword(rememberedLogin?.username === username.trim() ? (rememberedLogin?.password ?? "") : "");
    setError("");
  }

  async function handleMobileVerifyUsername(event?: React.FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      setError(t("auth.errorRequired") || (language === "zh-CN" ? "请输入用户名" : "Please enter username"));
      return;
    }
    setCheckingUser(true);
    setError("");
    try {
      const res = await api.checkUser(trimmed);
      if (!res.exists) {
        setError(language === "zh-CN" ? "该账户不存在，请检查用户名" : "Account does not exist");
        return;
      }
      setVerifiedUser({
        username: res.username,
        displayName: res.displayName,
        avatarDataUrl: res.avatarDataUrl
      });
      if (trimmed === rememberedLogin?.username && rememberedLogin?.password) {
        setPassword(rememberedLogin.password);
      } else if (trimmed !== rememberedLogin?.username) {
        setPassword("");
      }
      setTimeout(() => {
        mobilePasswordRef.current?.focus();
      }, 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : (language === "zh-CN" ? "验证账户失败" : "Failed to verify account"));
    } finally {
      setCheckingUser(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUsername = username.trim();
    const trimmedDisplayName = displayName.trim();
    if (isRegister) {
      if (!trimmedUsername || !trimmedDisplayName || !password) {
        setError(t("auth.errorRequired"));
        return;
      }
      if (password.length < 8) {
        setError(t("auth.errorPasswordLength"));
        return;
      }
      if (password !== confirmPassword) {
        setError(t("auth.errorPasswordMismatch"));
        return;
      }
    } else if (!password) {
      setError(language === "zh-CN" ? "请输入密码" : "Password is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = isRegister
        ? await api.register({
            username: trimmedUsername,
            displayName: trimmedDisplayName,
            password
          } satisfies RegisterRequest)
        : await api.login({
            username: trimmedUsername,
            password
          });
      if (rememberLogin) {
        saveRememberedLogin(trimmedUsername, password);
      } else {
        clearRememberedLogin();
      }
      setManualLogoutSuppressed(false);
      localStorage.setItem(tokenKey, response.token);
      onLogin(response.token, response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : isRegister ? t("auth.errorRegisterFailed") : t("auth.errorLoginFailed"));
    } finally {
      setLoading(false);
    }
  }

  const [sakiBubble, setSakiBubble] = useState<string | null>(null);
  const [sakiBouncing, setSakiBouncing] = useState(false);
  const sakiBubbleTimeoutRef = useRef<number | null>(null);
  const sakiBounceTimeoutRef = useRef<number | null>(null);

  const sakiHangQuotes = useMemo(() => [
    t("login.saki.quote.1"),
    t("login.saki.quote.2"),
    t("login.saki.quote.3"),
    t("login.saki.quote.4"),
    t("login.saki.quote.5")
  ], [t]);

  const handleSakiHangClick = () => {
    const randomQuote = sakiHangQuotes[Math.floor(Math.random() * sakiHangQuotes.length)] ?? t("login.saki.quote.1");
    setSakiBubble(randomQuote);
    setSakiBouncing(true);

    if (sakiBounceTimeoutRef.current) {
      window.clearTimeout(sakiBounceTimeoutRef.current);
    }
    sakiBounceTimeoutRef.current = window.setTimeout(() => {
      setSakiBouncing(false);
    }, 700);

    if (sakiBubbleTimeoutRef.current) {
      window.clearTimeout(sakiBubbleTimeoutRef.current);
    }
    sakiBubbleTimeoutRef.current = window.setTimeout(() => {
      setSakiBubble(null);
    }, 2800);
  };

  useEffect(() => {
    return () => {
      if (sakiBubbleTimeoutRef.current) {
        window.clearTimeout(sakiBubbleTimeoutRef.current);
      }
      if (sakiBounceTimeoutRef.current) {
        window.clearTimeout(sakiBounceTimeoutRef.current);
      }
    };
  }, []);

  return (
    <main className="login-shell saki-login-shell">
      <div className="login-top-actions mobile-login-top-actions">
        <LangDropdown language={language} setLanguage={setLanguage} />
        <button
          type="button"
          className={`login-theme-toggle theme-toggle-button${themeSwitching ? " theme-switching" : ""}`}
          onClick={onToggleDarkMode}
          title={darkMode ? (language === "zh-CN" ? "切换到浅色模式" : "Switch to light mode") : (language === "zh-CN" ? "切换到深色模式" : "Switch to dark mode")}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          <ThemeMorphIcon darkMode={darkMode} size={16} />
        </button>
      </div>

      <div className="mobile-login-stage">
        <div className="mobile-login-brand">
          <div className="mobile-login-logo-slot">
            {verifiedUser ? (
              <div key={`avatar-${verifiedUser.username}`} className="mobile-login-avatar-wrapper animate-avatar-in">
                <AccountAvatar
                  avatarDataUrl={verifiedUser.avatarDataUrl}
                  displayName={verifiedUser.displayName || verifiedUser.username}
                  username={verifiedUser.username}
                  className="mobile-login-user-avatar"
                />
              </div>
            ) : (
              <div key="brand-logo" className="brand-mark mobile-brand-mark animate-logo-in" aria-hidden="true">
                <img className="app-logo-img" src={appearance.appLogoSrc} alt="" draggable={false} />
              </div>
            )}
          </div>

          <div className="mobile-login-titles" key={verifiedUser ? `user-${verifiedUser.username}` : `brand-${mode}`}>
            {verifiedUser ? (
              <h1 className="mobile-user-name animate-title-in">
                {language === "zh-CN" ? `欢迎回来，${verifiedUser.username}` : `Welcome back, ${verifiedUser.username}`}
              </h1>
            ) : (
              <div className="animate-title-in mobile-brand-titles-inner">
                <h1>{appearance.appTitle}</h1>
                {appearance.appSubtitle || isRegister ? (
                  <p>{isRegister ? t("auth.createAccount") : appearance.appSubtitle}</p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {!isRegister ? (
          !verifiedUser ? (
            <form key="step1" className="mobile-capsule-form animate-step-in" onSubmit={handleMobileVerifyUsername}>
              <LiquidGlassContainer
                className="mobile-capsule-input-wrap saki-input-container saki-composer-glass"
                displacementScale={100}
                zoom={1.20}
                refractionIntensity={1.2}
                blurAmount={0}
                saturation={108}
                cornerRadius={26}
                mode="shader"
              >
                <input
                  className="mobile-capsule-input"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    if (error) setError("");
                  }}
                  autoComplete="username"
                  placeholder={t("auth.username.loginPlaceholder")}
                  autoFocus
                />
                <button
                  type="submit"
                  className="mobile-capsule-send-btn"
                  disabled={checkingUser || !username.trim()}
                  aria-label={language === "zh-CN" ? "验证账户" : "Verify account"}
                  title={language === "zh-CN" ? "验证账户" : "Verify account"}
                >
                  {checkingUser ? (
                    <Loader2 size={18} className="spin-icon" />
                  ) : (
                    <ArrowRight size={18} />
                  )}
                </button>
              </LiquidGlassContainer>

              {error ? (
                <div className="form-error mobile-form-error animate-error-shake" role="alert">
                  <AlertCircle size={15} className="mobile-error-icon" />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="auth-switch-prompt mobile-auth-switch-prompt">
                <span>{language === "zh-CN" ? "还没有账号？" : "Don't have an account?"}</span>
                <button
                  type="button"
                  className="auth-switch-link"
                  onClick={() => switchMode("register")}
                >
                  {language === "zh-CN" ? "立即注册" : "Register"}
                </button>
              </div>
            </form>
          ) : (
            <form key="step2" className="mobile-capsule-form animate-step-in" onSubmit={submit}>
              <LiquidGlassContainer
                className="mobile-capsule-input-wrap saki-input-container saki-composer-glass"
                displacementScale={100}
                zoom={1.20}
                refractionIntensity={1.2}
                blurAmount={0}
                saturation={108}
                cornerRadius={26}
                mode="shader"
              >
                <input
                  ref={mobilePasswordRef}
                  className="mobile-capsule-input mobile-capsule-password-input"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) setError("");
                  }}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder={t("auth.password.loginPlaceholder")}
                  autoFocus
                />
                <button
                  type="button"
                  className="mobile-capsule-eye-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
                <button
                  type="submit"
                  className="mobile-capsule-send-btn"
                  disabled={loading || !password}
                  aria-label={t("auth.loginSubmit")}
                  title={t("auth.loginSubmit")}
                >
                  {loading ? (
                    <Loader2 size={18} className="spin-icon" />
                  ) : (
                    <ArrowRight size={18} />
                  )}
                </button>
              </LiquidGlassContainer>

              <div className="mobile-auth-options-row animate-options-in">
                <label className="remember-password">
                  <input
                    type="checkbox"
                    checked={rememberLogin}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setRememberLogin(checked);
                      if (!checked) {
                        clearRememberedLogin();
                      }
                    }}
                  />
                  <span>{t("auth.rememberLogin")}</span>
                </label>
                <button
                  type="button"
                  className="mobile-back-link"
                  onClick={handleResetVerifiedUser}
                >
                  <ArrowLeft size={13} className="mobile-back-icon" />
                  <span>{language === "zh-CN" ? "返回上一步" : "Go back"}</span>
                </button>
              </div>

              {error ? (
                <div className="form-error mobile-form-error animate-error-shake" role="alert">
                  <AlertCircle size={15} className="mobile-error-icon" />
                  <span>{error}</span>
                </div>
              ) : null}
            </form>
          )
        ) : (
          <form key="register" className="mobile-capsule-form mobile-register-capsule-form animate-step-in" onSubmit={submit}>
            <LiquidGlassContainer
              className="mobile-capsule-input-wrap saki-input-container saki-composer-glass"
              displacementScale={100}
              zoom={1.20}
              refractionIntensity={1.2}
              blurAmount={0}
              saturation={108}
              cornerRadius={26}
              mode="shader"
            >
              <input
                className="mobile-capsule-input"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  if (error) setError("");
                }}
                autoComplete="username"
                placeholder={t("auth.username.registerPlaceholder")}
              />
            </LiquidGlassContainer>

            <LiquidGlassContainer
              className="mobile-capsule-input-wrap saki-input-container saki-composer-glass"
              displacementScale={100}
              zoom={1.20}
              refractionIntensity={1.2}
              blurAmount={0}
              saturation={108}
              cornerRadius={26}
              mode="shader"
            >
              <input
                className="mobile-capsule-input"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  if (error) setError("");
                }}
                autoComplete="name"
                placeholder={t("auth.displayName.placeholder")}
              />
            </LiquidGlassContainer>

            <LiquidGlassContainer
              className="mobile-capsule-input-wrap saki-input-container saki-composer-glass"
              displacementScale={100}
              zoom={1.20}
              refractionIntensity={1.2}
              blurAmount={0}
              saturation={108}
              cornerRadius={26}
              mode="shader"
            >
              <input
                className="mobile-capsule-input mobile-capsule-password-input"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) setError("");
                }}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder={t("auth.password.registerPlaceholder")}
              />
              <button
                type="button"
                className="mobile-capsule-eye-btn"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </LiquidGlassContainer>

            <LiquidGlassContainer
              className="mobile-capsule-input-wrap saki-input-container saki-composer-glass"
              displacementScale={100}
              zoom={1.20}
              refractionIntensity={1.2}
              blurAmount={0}
              saturation={108}
              cornerRadius={26}
              mode="shader"
            >
              <input
                className="mobile-capsule-input mobile-capsule-password-input"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  if (error) setError("");
                }}
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder={t("auth.confirmPassword.placeholder")}
              />
              <button
                type="button"
                className="mobile-capsule-eye-btn"
                onClick={() => setShowConfirmPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showConfirmPassword ? "隐藏密码" : "显示密码"}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </LiquidGlassContainer>

            <label className="remember-password">
              <input
                type="checkbox"
                checked={rememberLogin}
                onChange={(event) => {
                  setRememberLogin(event.target.checked);
                  if (!event.target.checked) clearRememberedLogin();
                }}
              />
              <span>{t("auth.rememberRegister")}</span>
            </label>

            {error ? (
              <div className="form-error mobile-form-error animate-error-shake" role="alert">
                <AlertCircle size={15} className="mobile-error-icon" />
                <span>{error}</span>
              </div>
            ) : null}

            <button className="primary-button mobile-register-btn" type="submit" disabled={loading}>
              {loading ? t("auth.registering") : t("auth.registerSubmit")}
              {!loading && <UserCheck size={18} />}
            </button>

            <div className="auth-switch-prompt mobile-auth-switch-prompt">
              <span>{language === "zh-CN" ? "已有账号？" : "Already have an account?"}</span>
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => switchMode("login")}
              >
                {language === "zh-CN" ? "立即登录" : "Login"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="login-container">
        <div className="login-visual" aria-hidden="true">
          <img className="login-cover-img" src={appearance.loginCoverSrc} alt="" draggable={false} />
        </div>
        <form className={`login-panel ${isRegister ? "register-panel" : ""}`} onSubmit={submit}>
          <div
            className={`login-saki-hang ${sakiBouncing ? "is-bouncing" : ""}`}
            onClick={handleSakiHangClick}
            title="戳戳 Saki ~"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleSakiHangClick();
              }
            }}
          >
            {sakiBubble ? (
              <div className="login-saki-bubble" role="status">
                {sakiBubble}
              </div>
            ) : null}
            <img
              src={sakiArtAssets.hang}
              alt="Saki"
              className="login-saki-hang-img"
              draggable={false}
            />
          </div>

          <div className="login-top-actions">
            <LangDropdown language={language} setLanguage={setLanguage} />
            <button
              type="button"
              className={`login-theme-toggle theme-toggle-button${themeSwitching ? " theme-switching" : ""}`}
              onClick={onToggleDarkMode}
              title={darkMode ? (language === "zh-CN" ? "切换到浅色模式" : "Switch to light mode") : (language === "zh-CN" ? "切换到深色模式" : "Switch to dark mode")}
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              <ThemeMorphIcon darkMode={darkMode} size={16} />
            </button>
          </div>

          <div className="login-header">
            <div className="brand-mark" aria-hidden="true">
              <img className="app-logo-img" src={appearance.appLogoSrc} alt="" draggable={false} />
            </div>
            <div>
              <h1>{appearance.appTitle}</h1>
              {appearance.appSubtitle || isRegister ? <p>{isRegister ? t("auth.createAccount") : appearance.appSubtitle}</p> : null}
            </div>
          </div>

          <div className="form-group">
            <label>
              <span className="label-text">{t("auth.username")}</span>
              <div className="input-with-icon">
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder={isRegister ? t("auth.username.registerPlaceholder") : t("auth.username.loginPlaceholder")}
                />
              </div>
            </label>
          </div>

          {isRegister ? (
            <div className="form-group">
              <label>
                <span className="label-text">{t("auth.displayName")}</span>
                <div className="input-with-icon">
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    autoComplete="name"
                    placeholder={t("auth.displayName.placeholder")}
                  />
                </div>
              </label>
            </div>
          ) : null}

          <div className="form-group">
            <label>
              <span className="label-text">{t("auth.password")}</span>
              <div className="input-with-icon password-input-wrap">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  placeholder={isRegister ? t("auth.password.registerPlaceholder") : t("auth.password.loginPlaceholder")}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
          </div>

          {isRegister ? (
            <div className="form-group">
              <label>
                <span className="label-text">{t("auth.confirmPassword")}</span>
                <div className="input-with-icon password-input-wrap">
                  <input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={t("auth.confirmPassword.placeholder")}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            </div>
          ) : null}

          {!isRegister ? (
            <div className="auth-options-row">
              <label className="remember-password">
                <input
                  type="checkbox"
                  checked={rememberLogin}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setRememberLogin(checked);
                    if (!checked) {
                      clearRememberedLogin();
                    }
                  }}
                />
                <span>{t("auth.rememberLogin")}</span>
              </label>
            </div>
          ) : (
            <label className="remember-password">
              <input
                type="checkbox"
                checked={rememberLogin}
                onChange={(event) => {
                  setRememberLogin(event.target.checked);
                  if (!event.target.checked) clearRememberedLogin();
                }}
              />
              <span>{t("auth.rememberRegister")}</span>
            </label>
          )}

          {error ? <div className="form-error">{error}</div> : null}

          <button className="primary-button login-btn" type="submit" disabled={loading}>
            {loading ? (isRegister ? t("auth.registering") : t("auth.loggingIn")) : isRegister ? t("auth.registerSubmit") : t("auth.loginSubmit")}
            {!loading && (isRegister ? <UserCheck size={18} /> : <KeyRound size={18} />)}
          </button>

          <div className="auth-switch-prompt">
            <span>{isRegister ? (language === "zh-CN" ? "已有账号？" : "Already have an account?") : (language === "zh-CN" ? "还没有账号？" : "Don't have an account?")}</span>
            <button
              type="button"
              className="auth-switch-link"
              onClick={() => switchMode(isRegister ? "login" : "register")}
            >
              {isRegister ? (language === "zh-CN" ? "立即登录" : "Login") : (language === "zh-CN" ? "立即注册" : "Register")}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
