import { useEffect, useRef, useState, type PointerEvent } from "react";
import { isMobileCallDevice, type SakiCallAudio } from "../sakiCallVoice.js";
import type { createVideoCallMotion, SakiAvatarPhase, SakiPresentationTarget } from "./videoCallMotion.js";
import { callPointerPosition, callTouchRegion, type SakiTouchRegion } from "./videoCallPointer.js";
import { createVideoCallQuality } from "./videoCallQuality.js";

const avatarPage = import.meta.env.BASE_URL + "saki-avatar/Saki_Preview.html?mode=call&view=full&layout=panel";

export function SakiCallAvatar({ audio, motion, phase, turnId, heard, language, compact, presentationTarget, onPresentedChange }: {
  audio: SakiCallAudio;
  motion: ReturnType<typeof createVideoCallMotion>;
  phase: Exclude<SakiAvatarPhase, "speaking">;
  turnId: string | undefined;
  heard: boolean;
  language: string;
  compact: boolean;
  presentationTarget: SakiPresentationTarget;
  onPresentedChange: (target: SakiPresentationTarget) => void;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const press = useRef<{ id: number; region: SakiTouchRegion | null } | null>(null);
  const state = useRef({ phase, turnId, heard, compact, presentationTarget });
  state.current = { phase, turnId, heard, compact, presentationTarget };
  const [status, setStatus] = useState<"loading" | "ready" | "delayed">("loading");
  const [attempt, setAttempt] = useState(0);
  const zh = language.startsWith("zh");

  function pointerPosition(event: PointerEvent<HTMLDivElement>) {
    return iframe.current ? callPointerPosition(iframe.current, event.clientX, event.clientY) : null;
  }

  function handlePress(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || press.current) return;
    const position = pointerPosition(event);
    if (!position) return;
    const region = callTouchRegion(position);
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { id: event.pointerId, region };
    if (region) motion.touch(region, position.x < 500 ? -1 : 1);
    else motion.pointerLook(position.gazeX, position.gazeY);
  }

  function handleMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) return;
    if (!press.current) {
      event.currentTarget.toggleAttribute("data-over-avatar", Boolean(callTouchRegion(pointerPosition(event), false)));
    } else if (press.current.id === event.pointerId && !press.current.region) {
      const position = pointerPosition(event);
      if (position) motion.pointerLook(position.gazeX, position.gazeY);
    }
  }

  function handleRelease(event: PointerEvent<HTMLDivElement>) {
    if (press.current?.id !== event.pointerId) return;
    press.current = null;
    motion.releasePointer(event.type !== "pointerup");
    event.currentTarget.removeAttribute("data-over-avatar");
  }

  useEffect(() => {
    const frame = iframe.current;
    if (!frame) return;
    const { origin } = window.location;
    const device = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean; downlink?: number; rtt?: number };
    };
    const perfLite = document.documentElement.classList.contains("perf-lite");
    const mobile = isMobileCallDevice();
    const quality = createVideoCallQuality({
      compact: true,
      cores: navigator.hardwareConcurrency,
      memory: device.deviceMemory ?? (mobile ? 4 : 0),
      saveData: perfLite || (device.connection?.saveData ?? false),
      downlink: device.connection?.downlink ?? 0,
      rtt: device.connection?.rtt ?? 0
    });
    let ready = false;
    let visible = true;
    let animation = 0;
    let nextPose = 0;
    let nextStatus = 0;
    let lastPhrase = "";
    let presented: SakiPresentationTarget = 0;
    const timeout = window.setTimeout(() => setStatus("delayed"), 16000);
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      quality.reset();
    });
    observer.observe(frame);

    function receive(event: MessageEvent) {
      if (event.origin !== origin || event.source !== frame?.contentWindow) return;
      if (event.data?.type === "saki-call-ready" && !ready) {
        ready = true;
        window.clearTimeout(timeout);
        setStatus("ready");
      }
      if (event.data?.type === "saki-call-walk-ready") motion.loadWalkProfiles(event.data.profiles);
      if (event.data?.type === "saki-call-reactions-ready") motion.loadReactionClips(event.data.durations);
    }

    function animate(now: number) {
      animation = window.requestAnimationFrame(animate);
      const target = frame?.contentWindow;
      if (!target || !visible) return;
      const level = quality.sample(now);
      if (!ready && now >= nextStatus) {
        target.postMessage({ type: "saki-call-status" }, origin);
        nextStatus = now + 450;
      }
      if (now + 1 < nextPose) return;
      const playback = audio.getAvatarSpeech(now);
      const current = state.current;
      if (playback.text !== lastPhrase) {
        lastPhrase = playback.text;
        if (lastPhrase) motion.react(lastPhrase);
      }
      const pose = motion.tick(now, {
        ...current,
        phase: playback.active ? "speaking" : current.phase,
        voice: playback.voice,
        articulation: playback.articulation
      });
      target.postMessage({
        type: "saki-call-motion", pose, compact: current.compact,
        theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        quality: level, compactAssets: quality.compactAssets,
        thinking: current.phase === "thinking" && !playback.active
      }, origin);
      const arrived = pose.presented ? current.presentationTarget : 0;
      if (arrived !== presented) {
        presented = arrived;
        onPresentedChange(presented);
      }
      nextPose = Math.max(now + quality.interval / 2, nextPose + quality.interval);
    }

    window.addEventListener("message", receive);
    animation = window.requestAnimationFrame(animate);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(animation);
      window.removeEventListener("message", receive);
    };
  }, [attempt, audio, motion, onPresentedChange]);

  return (
    <>
      <iframe key={attempt} ref={iframe} src={avatarPage} tabIndex={-1}
        title={zh ? "Saki Live2D 实时形象" : "Saki Live2D avatar"}
        className="saki-task-call-avatar" data-ready={status === "ready"} />
      {status === "ready" ? (
        <div className="saki-task-call-avatar-interaction" aria-hidden="true"
          onPointerDown={handlePress} onPointerMove={handleMove} onPointerUp={handleRelease}
          onPointerCancel={handleRelease} onLostPointerCapture={handleRelease}
          onPointerLeave={(event) => event.currentTarget.removeAttribute("data-over-avatar")} />
      ) : null}
      {status !== "ready" ? (
        <div className="saki-task-call-avatar-status" role="status">
          <span>{status === "loading" ? (zh ? "正在加载 Live2D" : "Loading Live2D")
            : (zh ? "Live2D 仍在加载" : "Live2D is taking longer to load")}</span>
          {status === "delayed" ? <button type="button" onClick={() => {
            setStatus("loading");
            setAttempt((value) => value + 1);
          }}>{zh ? "重新加载" : "Reload"}</button> : null}
        </div>
      ) : null}
    </>
  );
}
