import type { InstalledPlugin, PublicActiveTheme } from "@webops/shared";

const THEME_STYLE_ID = "saki-plugin-active-theme";
const THEME_CLASS_RE = /^saki-plugin-theme-[A-Za-z0-9_-]{1,40}$/;

function clearPluginThemeClasses(html: HTMLElement) {
  const toRemove: string[] = [];
  html.classList.forEach((cls) => {
    if (cls.startsWith("saki-plugin-theme-")) toRemove.push(cls);
  });
  for (const cls of toRemove) html.classList.remove(cls);
}

export function applyPluginTheme(plugin: InstalledPlugin | null): void {
  if (typeof document === "undefined") return;

  const existing = document.getElementById(THEME_STYLE_ID) as HTMLLinkElement | null;
  const html = document.documentElement;
  clearPluginThemeClasses(html);

  if (!plugin || !plugin.enabled || !plugin.manifest.theme?.css) {
    if (existing) existing.remove();
    html.style.removeProperty("--plugin-theme-bg-light");
    html.style.removeProperty("--plugin-theme-bg-dark");
    return;
  }

  const theme = plugin.manifest.theme;
  const cssPath = theme.css.replace(/^[/\\]+/, "");
  const href = `/api/plugins/${encodeURIComponent(plugin.id)}/assets/${cssPath}?v=${encodeURIComponent(plugin.manifest.version)}`;

  if (existing) {
    if (existing.getAttribute("href") !== href) {
      existing.setAttribute("href", href);
    }
  } else {
    const link = document.createElement("link");
    link.id = THEME_STYLE_ID;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  const htmlClass = theme.htmlClass?.trim();
  if (htmlClass && THEME_CLASS_RE.test(htmlClass)) {
    html.classList.add(htmlClass);
  }

  const assetBase = `/api/plugins/${encodeURIComponent(plugin.id)}/assets/`;
  if (theme.backgrounds?.light) {
    const light = theme.backgrounds.light.replace(/^[/\\]+/, "");
    html.style.setProperty("--plugin-theme-bg-light", `url("${assetBase}${light}")`);
  } else {
    html.style.removeProperty("--plugin-theme-bg-light");
  }
  if (theme.backgrounds?.dark) {
    const dark = theme.backgrounds.dark.replace(/^[/\\]+/, "");
    html.style.setProperty("--plugin-theme-bg-dark", `url("${assetBase}${dark}")`);
  } else {
    html.style.removeProperty("--plugin-theme-bg-dark");
  }
}

export function applyPublicTheme(info: PublicActiveTheme | null): void {
  if (!info?.css) {
    applyPluginTheme(null);
    return;
  }
  applyPluginTheme({
    id: info.id,
    enabled: true,
    installedAt: "",
    localPath: "",
    manifest: {
      name: info.id,
      version: info.version,
      displayName: info.id,
      description: "",
      author: "",
      type: "theme",
      theme: {
        css: info.css,
        htmlClass: info.htmlClass,
        backgrounds: info.backgrounds
      }
    }
  });
}
