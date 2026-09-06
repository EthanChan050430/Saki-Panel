import React, { useEffect, useRef } from "react";
import type { PanelAppearanceSettings } from "@webops/shared";
import { getEffectiveBackgroundSources } from "../../utils/appearance.js";

export interface AppBackgroundProps {
  appearance: PanelAppearanceSettings;
  darkMode: boolean;
}

export function AppBackground({ appearance, darkMode }: AppBackgroundProps) {
  const { desktopSrc, mobileSrc, isDesktopVideo, isMobileVideo } = getEffectiveBackgroundSources(appearance, darkMode);
  const desktopVideoRef = useRef<HTMLVideoElement | null>(null);
  const mobileVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (isDesktopVideo && desktopVideoRef.current) {
      desktopVideoRef.current.play().catch(() => {});
    }
  }, [desktopSrc, isDesktopVideo]);

  useEffect(() => {
    if (isMobileVideo && mobileVideoRef.current) {
      mobileVideoRef.current.play().catch(() => {});
    }
  }, [mobileSrc, isMobileVideo]);

  // Fallback trigger for strict autoplay policies on first interaction
  useEffect(() => {
    if (!isDesktopVideo && !isMobileVideo) return;

    const handleUserGesture = () => {
      if (desktopVideoRef.current && desktopVideoRef.current.paused) {
        desktopVideoRef.current.play().catch(() => {});
      }
      if (mobileVideoRef.current && mobileVideoRef.current.paused) {
        mobileVideoRef.current.play().catch(() => {});
      }
    };

    window.addEventListener("click", handleUserGesture, { passive: true });
    window.addEventListener("touchstart", handleUserGesture, { passive: true });
    window.addEventListener("keydown", handleUserGesture, { passive: true });

    return () => {
      window.removeEventListener("click", handleUserGesture);
      window.removeEventListener("touchstart", handleUserGesture);
      window.removeEventListener("keydown", handleUserGesture);
    };
  }, [isDesktopVideo, isMobileVideo]);

  if (!isDesktopVideo && !isMobileVideo) {
    return null;
  }

  return (
    <div className="app-bg-video-container" aria-hidden="true">
      {isDesktopVideo ? (
        <video
          ref={desktopVideoRef}
          key={`desktop-${desktopSrc}`}
          className="app-bg-video app-bg-video-desktop"
          src={desktopSrc}
          autoPlay
          loop
          muted
          playsInline
          tabIndex={-1}
          disablePictureInPicture
          disableRemotePlayback
        />
      ) : null}
      {isMobileVideo ? (
        <video
          ref={mobileVideoRef}
          key={`mobile-${mobileSrc}`}
          className="app-bg-video app-bg-video-mobile"
          src={mobileSrc}
          autoPlay
          loop
          muted
          playsInline
          tabIndex={-1}
          disablePictureInPicture
          disableRemotePlayback
        />
      ) : null}
    </div>
  );
}
