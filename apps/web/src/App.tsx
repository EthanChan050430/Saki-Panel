import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { RefreshCw } from "lucide-react";
import type { CurrentUser, PanelAppearanceSettings } from "@webops/shared";
import { api, ApiError } from "./api.js";
import { defaultPanelAppearance, panelLanguageKey, tokenKey } from "./constants.js";
import {
  PanelLanguageContext,
  applyPanelDomLanguage,
  attributesBeingTranslated,
  domTextOriginals,
  nodesBeingTranslated,
  panelT,
  readPanelLanguage,
  translateDomAttributeValue,
  translateDomText,
  type PanelLanguage,
  type PanelLanguageContextValue,
  type PanelTextKey
} from "./i18n/index.js";
import { applyPanelAppearance, normalizePanelAppearance } from "./utils/appearance.js";
import {
  isManualLogoutSuppressed,
  readAutoLogin,
  readRememberedLogin,
  saveAutoLogin,
  saveRememberedLogin,
  setManualLogoutSuppressed,
  tokenExpiresAt
} from "./utils/auth.js";
import { ElegantCursor } from "./ElegantCursor.js";
import { LoginView } from "./views/LoginView.js";
import { Workspace } from "./Workspace.js";

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey));
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [booting, setBooting] = useState(() => {
    if (localStorage.getItem(tokenKey)) return true;
    if (!isManualLogoutSuppressed() && readAutoLogin()) {
      const saved = readRememberedLogin();
      if (saved?.username && saved?.password) return true;
    }
    return false;
  });
  const [appearance, setAppearance] = useState<PanelAppearanceSettings>(defaultPanelAppearance);
  const [language, setLanguage] = useState<PanelLanguage>(() => readPanelLanguage());
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("saki-panel-theme") === "dark";
    } catch { return false; }
  });
  const [themeSwitching, setThemeSwitching] = useState(false);
  const isSwitchingRef = useRef(false);
  const lastSwitchTimeRef = useRef(0);
  const activeAnimRef = useRef<Animation | null>(null);

  const toggleDarkMode = useCallback((event?: React.MouseEvent<HTMLElement>) => {
    const now = Date.now();
    // Synchronously throttle clicks: if already in transition or clicked within 450ms, ignore completely
    if (isSwitchingRef.current || now - lastSwitchTimeRef.current < 450) {
      return;
    }
    isSwitchingRef.current = true;
    lastSwitchTimeRef.current = now;
    setThemeSwitching(true);

    const nextIsDark = !darkMode;
    try {
      localStorage.setItem("saki-panel-theme", nextIsDark ? "dark" : "light");
    } catch {}

    const isAppearanceTransition =
      typeof document !== "undefined" &&
      typeof (document as any).startViewTransition === "function" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !document.documentElement.classList.contains("perf-lite");

    if (!isAppearanceTransition) {
      document.documentElement.classList.add("theme-transitioning");
      setDarkMode(nextIsDark);
      document.documentElement.setAttribute("data-theme", nextIsDark ? "dark" : "light");
      applyPanelAppearance(appearance, nextIsDark);
      window.setTimeout(() => {
        document.documentElement.classList.remove("theme-transitioning");
        isSwitchingRef.current = false;
        setThemeSwitching(false);
      }, 300);
      return;
    }

    let x = Math.round(window.innerWidth / 2);
    let y = Math.round(window.innerHeight / 2);
    if (event && typeof event.clientX === "number" && typeof event.clientY === "number" && (event.clientX !== 0 || event.clientY !== 0)) {
      x = Math.round(event.clientX);
      y = Math.round(event.clientY);
    } else {
      const btn = document.querySelector(".theme-toggle-button");
      if (btn) {
        const rect = btn.getBoundingClientRect();
        x = Math.round(rect.left + rect.width / 2);
        y = Math.round(rect.top + rect.height / 2);
      }
    }

    const endRadius = Math.ceil(Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    ));

    const cleanup = () => {
      isSwitchingRef.current = false;
      setThemeSwitching(false);
    };

    let transition: any;
    try {
      transition = (document as any).startViewTransition(() => {
        try {
          flushSync(() => {
            setDarkMode(nextIsDark);
            document.documentElement.setAttribute("data-theme", nextIsDark ? "dark" : "light");
            applyPanelAppearance(appearance, nextIsDark);
          });
        } catch {
          setDarkMode(nextIsDark);
          document.documentElement.setAttribute("data-theme", nextIsDark ? "dark" : "light");
          applyPanelAppearance(appearance, nextIsDark);
        }
      });
    } catch {
      setDarkMode(nextIsDark);
      document.documentElement.setAttribute("data-theme", nextIsDark ? "dark" : "light");
      applyPanelAppearance(appearance, nextIsDark);
      cleanup();
      return;
    }

    if (transition?.ready) {
      transition.ready
        .then(() => {
          try {
            const clipPath = [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`
            ];
            if (activeAnimRef.current) {
              try { activeAnimRef.current.cancel(); } catch {}
            }
            const anim = document.documentElement.animate(
              {
                clipPath
              },
              {
                duration: 380,
                easing: "cubic-bezier(0.16, 1, 0.3, 1)",
                pseudoElement: "::view-transition-new(root)",
                fill: "forwards"
              }
            );
            activeAnimRef.current = anim;
            anim.onfinish = cleanup;
            anim.oncancel = cleanup;
          } catch {
            cleanup();
          }
        })
        .catch(cleanup);
    }

    if (transition?.finished && typeof transition.finished.then === "function") {
      transition.finished.then(cleanup, cleanup);
    } else {
      window.setTimeout(cleanup, 400);
    }
  }, [appearance, darkMode]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const updateAppearanceState = useCallback((nextAppearance: PanelAppearanceSettings) => {
    setAppearance(normalizePanelAppearance(nextAppearance));
  }, []);

  const changeLanguage = useCallback((nextLanguage: PanelLanguage) => {
    setLanguage(nextLanguage);
    localStorage.setItem(panelLanguageKey, nextLanguage);
  }, []);
  const languageContextValue = useMemo<PanelLanguageContextValue>(
    () => ({
      language,
      setLanguage: changeLanguage,
      t: (key) => panelT(language, key)
    }),
    [changeLanguage, language]
  );

  const logout = useCallback((options?: { manual?: boolean }) => {
    const isManual = options?.manual ?? false;
    const currentToken = localStorage.getItem(tokenKey);
    if (currentToken) {
      void api.logout(currentToken).catch(() => undefined);
    }
    if (isManual) {
      setManualLogoutSuppressed(true);
    }
    localStorage.removeItem(tokenKey);
    setToken(null);
    setUser(null);
  }, []);

  const switchSession = useCallback((nextToken: string, nextUser: CurrentUser) => {
    localStorage.setItem(tokenKey, nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  useEffect(() => {
    api
      .sakiAppearance()
      .then(updateAppearanceState)
      .catch(() => undefined);
  }, [updateAppearanceState]);

  useEffect(() => {
    applyPanelAppearance(appearance, darkMode);
  }, [appearance, darkMode]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const applyLanguage = () => applyPanelDomLanguage(language);
    const frame = window.requestAnimationFrame(applyLanguage);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          const target = mutation.target;
          if (nodesBeingTranslated.has(target)) {
            nodesBeingTranslated.delete(target);
            continue;
          }
          domTextOriginals.set(target, target.nodeValue ?? "");
          const original = target.nodeValue ?? "";
          const nextValue = translateDomText(original, language);
          if (target.nodeValue !== nextValue) {
            nodesBeingTranslated.add(target);
            target.nodeValue = nextValue;
          }
          continue;
        }
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof Element || node instanceof DocumentFragment) {
            applyPanelDomLanguage(language, node);
          }
        }
        if (mutation.type === "attributes" && mutation.target instanceof Element && mutation.attributeName) {
          const target = mutation.target;
          const attr = mutation.attributeName;
          const attrs = attributesBeingTranslated.get(target);
          if (attrs && attrs.has(attr)) {
            attrs.delete(attr);
            if (attrs.size === 0) {
              attributesBeingTranslated.delete(target);
            }
            continue;
          }
          const value = target.getAttribute(attr);
          if (value !== null) {
            target.setAttribute(`data-i18n-original-${attr}`, value);
          } else {
            target.removeAttribute(`data-i18n-original-${attr}`);
          }
          const original = value ?? "";
          const nextValue = translateDomAttributeValue(original, language);
          if (target.getAttribute(attr) !== nextValue) {
            let targetAttrs = attributesBeingTranslated.get(target);
            if (!targetAttrs) {
              targetAttrs = new Set<string>();
              attributesBeingTranslated.set(target, targetAttrs);
            }
            targetAttrs.add(attr);
            target.setAttribute(attr, nextValue);
          }
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["title", "aria-label", "placeholder"]
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [language]);

  useEffect(() => {
    let cancelled = false;

    async function initializeAuth() {

      if (token && user) {
        return;
      }

      if (token && !user) {
        try {
          const currentUser = await api.me(token);
          if (!cancelled) {
            setUser(currentUser);
            setBooting(false);
          }
          return;
        } catch {
          // Token is invalid or expired
          localStorage.removeItem(tokenKey);
          if (!cancelled) {
            setToken(null);
          }
        }
      }

      if (!isManualLogoutSuppressed() && readAutoLogin()) {
        const saved = readRememberedLogin();
        if (saved?.username && saved?.password) {
          try {
            const response = await api.login({
              username: saved.username.trim(),
              password: saved.password
            });
            if (!cancelled) {
              saveRememberedLogin(saved.username.trim(), saved.password);
              saveAutoLogin(true);
              localStorage.setItem(tokenKey, response.token);
              setToken(response.token);
              setUser(response.user);
              setBooting(false);
            }
            return;
          } catch {
            // Auto login failed with saved credentials
            saveAutoLogin(false);
          }
        }
      }

      if (!cancelled) {
        setBooting(false);
      }
    }

    void initializeAuth();

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  useEffect(() => {
    if (!token) return;
    const expiresAt = tokenExpiresAt(token);
    if (!expiresAt) return;

    let timer: number | undefined;
    const scheduleLogout = () => {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        logout({ manual: false });
        return;
      }
      timer = window.setTimeout(scheduleLogout, Math.min(remainingMs, 60000));
    };

    scheduleLogout();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [logout, token]);

  if (booting) {
    return (
      <PanelLanguageContext.Provider value={languageContextValue}>
        <ElegantCursor />
        <main className="login-shell">
          <div className="loading-panel">
            <RefreshCw size={22} />
            {panelT(language, "common.loading")}
          </div>
        </main>
      </PanelLanguageContext.Provider>
    );
  }

  if (!token || !user) {
    return (
      <PanelLanguageContext.Provider value={languageContextValue}>
        <ElegantCursor />
        <LoginView
          appearance={appearance}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
          onLogin={(nextToken, nextUser) => {
            setToken(nextToken);
            setUser(nextUser);
          }}
        />
      </PanelLanguageContext.Provider>
    );
  }

  return (
    <PanelLanguageContext.Provider value={languageContextValue}>
      <ElegantCursor />
      <Workspace
        token={token}
        user={user}
        appearance={appearance}
        language={language}
        onLogout={logout}
        onSwitchUser={switchSession}
        onUserChange={setUser}
        onAppearanceChange={updateAppearanceState}
        onLanguageChange={changeLanguage}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        themeSwitching={themeSwitching}
      />
    </PanelLanguageContext.Provider>
  );
}

