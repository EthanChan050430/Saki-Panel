import React, { memo, useRef, useState } from "react";
import {
  Clock,
  Image as ImageIcon,
  Moon,
  Paintbrush,
  RotateCcw,
  Sun,
  Upload,
  Video
} from "lucide-react";
import type { PanelAppearanceSettings } from "@webops/shared";
import type { PanelTextKey } from "../../i18n/index.js";
import { defaultPanelAppearance } from "../../constants.js";
import { isVideoSource } from "../../utils/appearance.js";

export interface SettingsAppearanceTabProps {
  isActive: boolean;
  appearance: PanelAppearanceSettings;
  onUpdateAppearance: (patch: Partial<PanelAppearanceSettings>) => void;
  onChooseAppearanceImage: (
    field: "appLogoSrc" | "sidebarLogoSrc" | "loginCoverSrc" | "defaultAvatarSrc",
    event: React.ChangeEvent<HTMLInputElement>
  ) => void;
  onChooseAppearanceMedia: (
    field: "backgroundSrc" | "mobileBackgroundSrc" | "darkBackgroundSrc" | "mobileDarkBackgroundSrc",
    event: React.ChangeEvent<HTMLInputElement>,
    allowVideo?: boolean
  ) => void;
  t: (key: PanelTextKey) => string;
}

export const SettingsAppearanceTab = memo(function SettingsAppearanceTab({
  isActive,
  appearance,
  onUpdateAppearance,
  onChooseAppearanceImage,
  onChooseAppearanceMedia,
  t
}: SettingsAppearanceTabProps) {
  const [bgThemeTab, setBgThemeTab] = useState<"light" | "dark" | "all">("light");

  const appLogoInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarLogoInputRef = useRef<HTMLInputElement | null>(null);
  const loginCoverInputRef = useRef<HTMLInputElement | null>(null);
  const defaultAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const mobileBackgroundInputRef = useRef<HTMLInputElement | null>(null);
  const darkBackgroundInputRef = useRef<HTMLInputElement | null>(null);
  const mobileDarkBackgroundInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      className={`settings-group ${isActive ? "active" : "settings-section-hidden"}`}
      id="settings-appearance"
    >
      {/* Hidden file inputs inside the tab container */}
      <input
        ref={appLogoInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/bmp,image/avif,image/*"
        onChange={(event) => onChooseAppearanceImage("appLogoSrc", event)}
      />
      <input
        ref={sidebarLogoInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/bmp,image/avif,image/*"
        onChange={(event) => onChooseAppearanceImage("sidebarLogoSrc", event)}
      />
      <input
        ref={loginCoverInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/bmp,image/avif,image/*"
        onChange={(event) => onChooseAppearanceImage("loginCoverSrc", event)}
      />
      <input
        ref={defaultAvatarInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/bmp,image/avif,image/*"
        onChange={(event) => onChooseAppearanceImage("defaultAvatarSrc", event)}
      />
      <input
        ref={backgroundInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/bmp,image/avif,image/*,video/mp4,video/webm,video/ogg"
        onChange={(event) => onChooseAppearanceMedia("backgroundSrc", event, true)}
      />
      <input
        ref={mobileBackgroundInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/bmp,image/avif,image/*,video/mp4,video/webm,video/ogg"
        onChange={(event) => onChooseAppearanceMedia("mobileBackgroundSrc", event, true)}
      />
      <input
        ref={darkBackgroundInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/bmp,image/avif,image/*,video/mp4,video/webm,video/ogg"
        onChange={(event) => onChooseAppearanceMedia("darkBackgroundSrc", event, true)}
      />
      <input
        ref={mobileDarkBackgroundInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/bmp,image/avif,image/*,video/mp4,video/webm,video/ogg"
        onChange={(event) => onChooseAppearanceMedia("mobileDarkBackgroundSrc", event, true)}
      />

      <div className="settings-group-title">
        <div className="settings-group-icon">
          <ImageIcon size={20} />
        </div>
        <div>
          <h3>{t("settings.appearance")}</h3>
          <span>{t("settings.appearance.titleDetail")}</span>
        </div>
      </div>
      <div className="settings-group-content">
        <div className="settings-form-row">
          <label className="settings-field">
            <span className="settings-field-label">侧边栏标题</span>
            <input
              className="settings-input"
              value={appearance?.sidebarTitle ?? ""}
              onChange={(event) => onUpdateAppearance({ sidebarTitle: event.target.value })}
              placeholder="Saki Panel"
            />
          </label>

          <label className="settings-field">
            <span className="settings-field-label">登录页主标题</span>
            <input
              className="settings-input"
              value={appearance?.appTitle ?? ""}
              onChange={(event) => onUpdateAppearance({ appTitle: event.target.value })}
              placeholder="Saki Panel"
            />
          </label>
        </div>

        <label className="settings-field">
          <span className="settings-field-label">登录页副标题</span>
          <input
            className="settings-input"
            value={appearance?.appSubtitle ?? ""}
            onChange={(event) => onUpdateAppearance({ appSubtitle: event.target.value })}
            placeholder="System Administration"
          />
        </label>

        <div className="settings-asset-grid">
          {/* Login Cover */}
          <div className="settings-asset-card">
            <div className="settings-asset-preview-box cover">
              {appearance?.loginCoverSrc ? (
                <img src={appearance.loginCoverSrc} alt="登录封面" />
              ) : (
                <div className="settings-asset-empty">
                  <ImageIcon size={28} />
                  <span>未设置封面</span>
                </div>
              )}
            </div>
            <div className="settings-asset-meta">
              <strong>登录页封面大图</strong>
              <div className="settings-asset-input-wrap">
                <input
                  className="settings-input mini"
                  value={appearance?.loginCoverSrc ?? ""}
                  onChange={(event) => onUpdateAppearance({ loginCoverSrc: event.target.value })}
                  placeholder="/assets/cover.webp"
                />
                <button
                  className="ghost-button mini"
                  type="button"
                  onClick={() => loginCoverInputRef.current?.click()}
                  title="选择本地图片"
                >
                  <Upload size={14} />
                  <span>上传</span>
                </button>
                {appearance?.loginCoverSrc &&
                appearance.loginCoverSrc !== defaultPanelAppearance.loginCoverSrc ? (
                  <button
                    className="ghost-button mini reset-btn"
                    type="button"
                    onClick={() =>
                      onUpdateAppearance({ loginCoverSrc: defaultPanelAppearance.loginCoverSrc })
                    }
                    title="恢复默认封面"
                  >
                    <RotateCcw size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* App Logo */}
          <div className="settings-asset-card">
            <div className="settings-asset-preview-box square">
              {appearance?.appLogoSrc ? (
                <img src={appearance.appLogoSrc} alt="应用图标" />
              ) : (
                <div className="settings-asset-empty">
                  <ImageIcon size={24} />
                  <span>默认图标</span>
                </div>
              )}
            </div>
            <div className="settings-asset-meta">
              <strong>应用图标 (Favicon/Logo)</strong>
              <div className="settings-asset-input-wrap">
                <input
                  className="settings-input mini"
                  value={appearance?.appLogoSrc ?? ""}
                  onChange={(event) => onUpdateAppearance({ appLogoSrc: event.target.value })}
                  placeholder="/assets/saki-panel-icon.webp"
                />
                <button
                  className="ghost-button mini"
                  type="button"
                  onClick={() => appLogoInputRef.current?.click()}
                  title="选择本地图片"
                >
                  <Upload size={14} />
                  <span>上传</span>
                </button>
                {appearance?.appLogoSrc &&
                appearance.appLogoSrc !== defaultPanelAppearance.appLogoSrc ? (
                  <button
                    className="ghost-button mini reset-btn"
                    type="button"
                    onClick={() =>
                      onUpdateAppearance({ appLogoSrc: defaultPanelAppearance.appLogoSrc })
                    }
                    title="恢复默认图标"
                  >
                    <RotateCcw size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Sidebar Logo */}
          <div className="settings-asset-card">
            <div className="settings-asset-preview-box square">
              {appearance?.sidebarLogoSrc ? (
                <img src={appearance.sidebarLogoSrc} alt="侧边栏图标" />
              ) : (
                <div className="settings-asset-empty">
                  <ImageIcon size={24} />
                  <span>侧栏图标</span>
                </div>
              )}
            </div>
            <div className="settings-asset-meta">
              <strong>侧边栏 Logo</strong>
              <div className="settings-asset-input-wrap">
                <input
                  className="settings-input mini"
                  value={appearance?.sidebarLogoSrc ?? ""}
                  onChange={(event) => onUpdateAppearance({ sidebarLogoSrc: event.target.value })}
                  placeholder="/assets/saki-panel-icon.webp"
                />
                <button
                  className="ghost-button mini"
                  type="button"
                  onClick={() => sidebarLogoInputRef.current?.click()}
                  title="选择本地图片"
                >
                  <Upload size={14} />
                  <span>上传</span>
                </button>
                {appearance?.sidebarLogoSrc &&
                appearance.sidebarLogoSrc !== defaultPanelAppearance.sidebarLogoSrc ? (
                  <button
                    className="ghost-button mini reset-btn"
                    type="button"
                    onClick={() =>
                      onUpdateAppearance({ sidebarLogoSrc: defaultPanelAppearance.sidebarLogoSrc })
                    }
                    title="恢复默认侧边栏图标"
                  >
                    <RotateCcw size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="settings-asset-card">
            <div className="settings-asset-preview-box square circle">
              {appearance?.defaultAvatarSrc ? (
                <img src={appearance.defaultAvatarSrc} alt="默认用户头像" />
              ) : (
                <div className="settings-asset-empty">
                  <ImageIcon size={24} />
                  <span>默认头像</span>
                </div>
              )}
            </div>
            <div className="settings-asset-meta">
              <strong>默认用户头像</strong>
              <span className="settings-asset-hint">未上传个人头像的用户会显示这张图</span>
              <div className="settings-asset-input-wrap">
                <input
                  className="settings-input mini"
                  value={appearance?.defaultAvatarSrc ?? ""}
                  onChange={(event) => onUpdateAppearance({ defaultAvatarSrc: event.target.value })}
                  placeholder="/assets/head.webp"
                />
                <button
                  className="ghost-button mini"
                  type="button"
                  onClick={() => defaultAvatarInputRef.current?.click()}
                  title="选择本地图片"
                >
                  <Upload size={14} />
                  <span>上传</span>
                </button>
                {appearance?.defaultAvatarSrc &&
                appearance.defaultAvatarSrc !== defaultPanelAppearance.defaultAvatarSrc ? (
                  <button
                    className="ghost-button mini reset-btn"
                    type="button"
                    onClick={() =>
                      onUpdateAppearance({ defaultAvatarSrc: defaultPanelAppearance.defaultAvatarSrc })
                    }
                    title="恢复默认头像"
                  >
                    <RotateCcw size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Custom Backgrounds & Live Wallpapers Section */}
        <div className="settings-bg-section">
          <div className="settings-bg-section-header">
            <div className="settings-bg-section-info">
              <h4>自定义系统壁纸与动态背景</h4>
              <span>
                分别自定义浅色与暗色模式下的桌面端与移动端背景，支持 PNG、JPG、WebP、GIF 图片及 MP4、WebM、OGG
                视频动态壁纸（上限 50MB）。
              </span>
            </div>
            <div className="settings-bg-theme-switcher">
              <button
                type="button"
                className={`settings-bg-tab-btn ${bgThemeTab === "light" ? "active" : ""}`}
                onClick={() => setBgThemeTab("light")}
              >
                <Sun size={14} />
                <span>浅色主题背景</span>
              </button>
              <button
                type="button"
                className={`settings-bg-tab-btn ${bgThemeTab === "dark" ? "active" : ""}`}
                onClick={() => setBgThemeTab("dark")}
              >
                <Moon size={14} />
                <span>暗色主题背景</span>
              </button>
              <button
                type="button"
                className={`settings-bg-tab-btn ${bgThemeTab === "all" ? "active" : ""}`}
                onClick={() => setBgThemeTab("all")}
              >
                <span>全部显示</span>
              </button>
            </div>
          </div>

          <div className="settings-asset-grid">
            {/* Light Theme Backgrounds */}
            {(bgThemeTab === "light" || bgThemeTab === "all") && (
              <>
                {/* Light Desktop Background */}
                <div className="settings-asset-card">
                  <div className="settings-asset-preview-box cover">
                    {appearance?.backgroundSrc ? (
                      isVideoSource(appearance.backgroundSrc) ? (
                        <video
                          className="settings-asset-preview-video"
                          src={appearance.backgroundSrc}
                          autoPlay
                          loop
                          muted
                          playsInline
                        />
                      ) : (
                        <img src={appearance.backgroundSrc} alt="桌面端浅色背景" />
                      )
                    ) : (
                      <div className="settings-asset-empty">
                        <Paintbrush size={24} />
                        <span>默认浅色壁纸</span>
                      </div>
                    )}
                    {appearance?.backgroundSrc ? (
                      <span className="settings-asset-type-badge">
                        {isVideoSource(appearance.backgroundSrc) ? (
                          <>
                            <Video size={11} /> 动态视频
                          </>
                        ) : (
                          <>
                            <ImageIcon size={11} /> 静态图片
                          </>
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div className="settings-asset-meta">
                    <div className="settings-asset-title-row">
                      <strong>桌面端背景 (浅色模式)</strong>
                      <span className="settings-theme-tag light">
                        <Sun size={12} /> 浅色
                      </span>
                    </div>
                    <div className="settings-asset-input-wrap">
                      <input
                        className="settings-input mini"
                        value={appearance?.backgroundSrc ?? ""}
                        onChange={(event) => onUpdateAppearance({ backgroundSrc: event.target.value })}
                        placeholder="/assets/background.webp"
                      />
                      <button
                        className="ghost-button mini"
                        type="button"
                        onClick={() => backgroundInputRef.current?.click()}
                        title="选择本地图片或视频 (MP4/WebM/OGG)"
                      >
                        <Upload size={14} />
                        <span>上传</span>
                      </button>
                      {appearance?.backgroundSrc &&
                      appearance.backgroundSrc !== defaultPanelAppearance.backgroundSrc ? (
                        <button
                          className="ghost-button mini reset-btn"
                          type="button"
                          onClick={() => onUpdateAppearance({ backgroundSrc: defaultPanelAppearance.backgroundSrc })}
                          title="恢复默认背景"
                        >
                          <RotateCcw size={13} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Light Mobile Background */}
                <div className="settings-asset-card">
                  <div className="settings-asset-preview-box portrait">
                    {appearance?.mobileBackgroundSrc ? (
                      isVideoSource(appearance.mobileBackgroundSrc) ? (
                        <video
                          className="settings-asset-preview-video"
                          src={appearance.mobileBackgroundSrc}
                          autoPlay
                          loop
                          muted
                          playsInline
                        />
                      ) : (
                        <img src={appearance.mobileBackgroundSrc} alt="移动端竖屏浅色背景" />
                      )
                    ) : (
                      <div className="settings-asset-empty">
                        <Paintbrush size={24} />
                        <span>默认竖屏壁纸</span>
                      </div>
                    )}
                    {appearance?.mobileBackgroundSrc ? (
                      <span className="settings-asset-type-badge">
                        {isVideoSource(appearance.mobileBackgroundSrc) ? (
                          <>
                            <Video size={11} /> 动态视频
                          </>
                        ) : (
                          <>
                            <ImageIcon size={11} /> 静态图片
                          </>
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div className="settings-asset-meta">
                    <div className="settings-asset-title-row">
                      <strong>移动端竖屏背景 (浅色模式)</strong>
                      <span className="settings-theme-tag light">
                        <Sun size={12} /> 浅色
                      </span>
                    </div>
                    <div className="settings-asset-input-wrap">
                      <input
                        className="settings-input mini"
                        value={appearance?.mobileBackgroundSrc ?? ""}
                        onChange={(event) =>
                          onUpdateAppearance({ mobileBackgroundSrc: event.target.value })
                        }
                        placeholder="/assets/background_mobile.webp"
                      />
                      <button
                        className="ghost-button mini"
                        type="button"
                        onClick={() => mobileBackgroundInputRef.current?.click()}
                        title="选择本地图片或视频 (MP4/WebM/OGG)"
                      >
                        <Upload size={14} />
                        <span>上传</span>
                      </button>
                      {appearance?.mobileBackgroundSrc &&
                      appearance.mobileBackgroundSrc !==
                        defaultPanelAppearance.mobileBackgroundSrc ? (
                        <button
                          className="ghost-button mini reset-btn"
                          type="button"
                          onClick={() =>
                            onUpdateAppearance({
                              mobileBackgroundSrc: defaultPanelAppearance.mobileBackgroundSrc
                            })
                          }
                          title="恢复默认背景"
                        >
                          <RotateCcw size={13} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Dark Theme Backgrounds */}
            {(bgThemeTab === "dark" || bgThemeTab === "all") && (
              <>
                {/* Dark Desktop Background */}
                <div className="settings-asset-card">
                  <div className="settings-asset-preview-box cover">
                    {appearance?.darkBackgroundSrc ? (
                      isVideoSource(appearance.darkBackgroundSrc) ? (
                        <video
                          className="settings-asset-preview-video"
                          src={appearance.darkBackgroundSrc}
                          autoPlay
                          loop
                          muted
                          playsInline
                        />
                      ) : (
                        <img src={appearance.darkBackgroundSrc} alt="桌面端暗色背景" />
                      )
                    ) : (
                      <div className="settings-asset-empty">
                        <Paintbrush size={24} />
                        <span>默认暗色壁纸</span>
                      </div>
                    )}
                    {appearance?.darkBackgroundSrc ? (
                      <span className="settings-asset-type-badge">
                        {isVideoSource(appearance.darkBackgroundSrc) ? (
                          <>
                            <Video size={11} /> 动态视频
                          </>
                        ) : (
                          <>
                            <ImageIcon size={11} /> 静态图片
                          </>
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div className="settings-asset-meta">
                    <div className="settings-asset-title-row">
                      <strong>桌面端背景 (暗色模式)</strong>
                      <span className="settings-theme-tag dark">
                        <Moon size={12} /> 暗色
                      </span>
                    </div>
                    <div className="settings-asset-input-wrap">
                      <input
                        className="settings-input mini"
                        value={appearance?.darkBackgroundSrc ?? ""}
                        onChange={(event) =>
                          onUpdateAppearance({ darkBackgroundSrc: event.target.value })
                        }
                        placeholder="/assets/background_dark.webp"
                      />
                      <button
                        className="ghost-button mini"
                        type="button"
                        onClick={() => darkBackgroundInputRef.current?.click()}
                        title="选择本地图片或视频 (MP4/WebM/OGG)"
                      >
                        <Upload size={14} />
                        <span>上传</span>
                      </button>
                      {appearance?.darkBackgroundSrc &&
                      appearance.darkBackgroundSrc !== defaultPanelAppearance.darkBackgroundSrc ? (
                        <button
                          className="ghost-button mini reset-btn"
                          type="button"
                          onClick={() =>
                            onUpdateAppearance({
                              darkBackgroundSrc: defaultPanelAppearance.darkBackgroundSrc
                            })
                          }
                          title="恢复默认背景"
                        >
                          <RotateCcw size={13} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Dark Mobile Background */}
                <div className="settings-asset-card">
                  <div className="settings-asset-preview-box portrait">
                    {appearance?.mobileDarkBackgroundSrc ? (
                      isVideoSource(appearance.mobileDarkBackgroundSrc) ? (
                        <video
                          className="settings-asset-preview-video"
                          src={appearance.mobileDarkBackgroundSrc}
                          autoPlay
                          loop
                          muted
                          playsInline
                        />
                      ) : (
                        <img src={appearance.mobileDarkBackgroundSrc} alt="移动端竖屏暗色背景" />
                      )
                    ) : (
                      <div className="settings-asset-empty">
                        <Paintbrush size={24} />
                        <span>默认竖屏壁纸</span>
                      </div>
                    )}
                    {appearance?.mobileDarkBackgroundSrc ? (
                      <span className="settings-asset-type-badge">
                        {isVideoSource(appearance.mobileDarkBackgroundSrc) ? (
                          <>
                            <Video size={11} /> 动态视频
                          </>
                        ) : (
                          <>
                            <ImageIcon size={11} /> 静态图片
                          </>
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div className="settings-asset-meta">
                    <div className="settings-asset-title-row">
                      <strong>移动端竖屏背景 (暗色模式)</strong>
                      <span className="settings-theme-tag dark">
                        <Moon size={12} /> 暗色
                      </span>
                    </div>
                    <div className="settings-asset-input-wrap">
                      <input
                        className="settings-input mini"
                        value={appearance?.mobileDarkBackgroundSrc ?? ""}
                        onChange={(event) =>
                          onUpdateAppearance({ mobileDarkBackgroundSrc: event.target.value })
                        }
                        placeholder="/assets/background_mobile_dark.webp"
                      />
                      <button
                        className="ghost-button mini"
                        type="button"
                        onClick={() => mobileDarkBackgroundInputRef.current?.click()}
                        title="选择本地图片或视频 (MP4/WebM/OGG)"
                      >
                        <Upload size={14} />
                        <span>上传</span>
                      </button>
                      {appearance?.mobileDarkBackgroundSrc &&
                      appearance.mobileDarkBackgroundSrc !==
                        defaultPanelAppearance.mobileDarkBackgroundSrc ? (
                        <button
                          className="ghost-button mini reset-btn"
                          type="button"
                          onClick={() =>
                            onUpdateAppearance({
                              mobileDarkBackgroundSrc: defaultPanelAppearance.mobileDarkBackgroundSrc
                            })
                          }
                          title="恢复默认背景"
                        >
                          <RotateCcw size={13} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Show Server Time Toggle */}
        <div className="settings-switch-card">
          <div className="settings-switch-info">
            <div className="settings-switch-title">
              <Clock size={18} className="settings-switch-icon" />
              <strong>{t("settings.appearance.showServerTime")}</strong>
            </div>
            <span>{t("settings.appearance.showServerTimeDetail")}</span>
          </div>
          <label className="settings-switch-toggle">
            <input
              type="checkbox"
              checked={appearance?.showServerTime !== false}
              onChange={(e) => onUpdateAppearance({ showServerTime: e.target.checked })}
            />
            <span className="settings-switch-slider" />
          </label>
        </div>
      </div>
    </div>
  );
});
