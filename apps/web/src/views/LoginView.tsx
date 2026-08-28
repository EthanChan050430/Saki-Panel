import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Coins,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  LogIn,
  Moon,
  Sparkles,
  Sun,
  UserCheck,
  UserPlus
} from "lucide-react";
import type { CurrentUser, PanelAppearanceSettings, RegisterRequest, RegistrationIdentity } from "@webops/shared";
import { api, ApiError } from "../api.js";
import { sakiArtAssets, tokenKey } from "../constants.js";
import { panelLanguageOptions, type PanelLanguage, usePanelLanguage, usePanelT } from "../i18n/index.js";
import {
  clearRememberedLogin,
  isManualLogoutSuppressed,
  readAutoLogin,
  readRememberedLogin,
  saveAutoLogin,
  saveRememberedLogin,
  setManualLogoutSuppressed
} from "../utils/auth.js";

export type AuthMode = "login" | "register";

export function LoginView({
  appearance,
  onLogin,
  darkMode,
  onToggleDarkMode
}: {
  appearance: PanelAppearanceSettings;
  onLogin: (token: string, user: CurrentUser) => void;
  darkMode: boolean;
  onToggleDarkMode: (e?: React.MouseEvent<HTMLElement>) => void;
}) {
  const t = usePanelT();
  const { language, setLanguage } = usePanelLanguage();
  const rememberedLogin = useMemo(() => readRememberedLogin(), []);
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState(rememberedLogin?.username ?? "admin");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState(rememberedLogin?.password ?? "");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(Boolean(rememberedLogin));
  const [autoLogin, setAutoLogin] = useState(() => readAutoLogin() && Boolean(rememberedLogin));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const isRegister = mode === "register";
  const autoLoginAttemptedRef = useRef(false);

  useEffect(() => {
    if (autoLoginAttemptedRef.current) return;
    if (mode !== "login") return;
    if (isManualLogoutSuppressed()) return;
    const saved = readRememberedLogin();
    const isAuto = readAutoLogin();
    if (isAuto && saved?.username && saved?.password) {
      autoLoginAttemptedRef.current = true;
      setLoading(true);
      setError("");
      api.login({
        username: saved.username.trim(),
        password: saved.password
      })
        .then((response) => {
          saveRememberedLogin(saved.username.trim(), saved.password);
          saveAutoLogin(true);
          setManualLogoutSuppressed(false);
          localStorage.setItem(tokenKey, response.token);
          onLogin(response.token, response.user);
        })
        .catch((err) => {
          saveAutoLogin(false);
          setAutoLogin(false);
          setError(err instanceof Error ? err.message : t("auth.errorLoginFailed"));
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [mode, onLogin, t]);

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setError("");
    setPassword("");
    setConfirmPassword("");
    if (nextMode === "register") {
      setUsername("");
      setDisplayName("");
      return;
    }
    setUsername(rememberedLogin?.username ?? "admin");
    setDisplayName("");
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
      if (rememberPassword) {
        saveRememberedLogin(trimmedUsername, password);
        saveAutoLogin(!isRegister && autoLogin);
      } else {
        clearRememberedLogin();
        saveAutoLogin(false);
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

  const sakiHangQuotes = useMemo(() => {
    if (language === "en-US") {
      return [
        "Saki is watching you log in~ ✨",
        "Let's be full of energy today too! (｡♥‿♥｡)",
        "Welcome to Saki Panel~ 🌸",
        "Log in and we can play together!",
        "Work hard today~ ฅ'ω'ฅ"
      ];
    }
    if (language === "zh-TW") {
      return [
        "Saki 正在看著你登入哦~ ✨",
        "今天也要元氣滿滿！(｡♥‿♥｡)",
        "歡迎來到 Saki Panel~ 🌸",
        "登入後就可以和 Saki 一起玩啦！",
        "加油工作呀~ ฅ'ω'ฅ"
      ];
    }
    return [
      "Saki 正在看着你登录哦~ ✨",
      "今天也要元气满满！(｡♥‿♥｡)",
      "欢迎来到 Saki Panel~ 🌸",
      "登录后就可以和 Saki 一起玩啦！",
      "加油工作呀~ ฅ'ω'ฅ"
    ];
  }, [language]);

  const handleSakiHangClick = () => {
    const randomQuote = sakiHangQuotes[Math.floor(Math.random() * sakiHangQuotes.length)] ?? "Saki 正在看着你登录哦~ ✨";
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
            <div className="login-lang-select-wrap">
              <Globe size={14} className="login-lang-icon" aria-hidden="true" />
              <select
                className="login-lang-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value as PanelLanguage)}
                aria-label="Panel language"
              >
                {panelLanguageOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="login-theme-toggle theme-toggle-button"
              onClick={onToggleDarkMode}
              title={darkMode ? "切换到浅色模式" : "切换到深色模式"}
              aria-label={darkMode ? "切换到浅色模式" : "切换到深色模式"}
            >
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
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
                  checked={rememberPassword}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setRememberPassword(checked);
                    if (!checked) {
                      clearRememberedLogin();
                      setAutoLogin(false);
                      saveAutoLogin(false);
                    }
                  }}
                />
                <span>{t("auth.rememberLogin")}</span>
              </label>

              <label className="remember-password auto-login-option">
                <input
                  type="checkbox"
                  checked={autoLogin}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setAutoLogin(checked);
                    saveAutoLogin(checked);
                    if (checked) {
                      setRememberPassword(true);
                      setManualLogoutSuppressed(false);
                    }
                  }}
                />
                <span>{t("auth.autoLogin")}</span>
              </label>
            </div>
          ) : (
            <label className="remember-password">
              <input
                type="checkbox"
                checked={rememberPassword}
                onChange={(event) => {
                  setRememberPassword(event.target.checked);
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
            <span>{isRegister ? "已有账号？" : "还没有账号？"}</span>
            <button
              type="button"
              className="auth-switch-link"
              onClick={() => switchMode(isRegister ? "login" : "register")}
            >
              {isRegister ? "立即登录" : "立即注册"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
