import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Captions, ChevronDown, ClipboardList, Globe, Keyboard, Maximize, Mic, MicOff, Minimize, Monitor, PhoneOff, ScanLine, Sparkles, SwitchCamera, Video, VideoOff, Volume2, VolumeX, X } from "lucide-react";
import type { SakiAgentAction, SakiInputAttachment, SakiModelOption } from "@webops/shared";
import type { BrowserSpeechRecognition } from "../../../types/app.js";
import { MarkdownContent } from "../../common/MarkdownContent.js";
import { LiquidGlassContainer } from "../../common/LiquidGlass.js";
import { SakiToolActionCard } from "../SakiComponents.js";
import { SakiModelList } from "../SakiModelReasoningPanel.js";
import { getSpeechRecognitionConstructor, type SakiModelPointsMultiplierMap } from "../sakiChatHelpers.js";
import { SakiCallTasksSidebar } from "./SakiCallTasksSidebar.js";
import { getSakiCallInterruption, getSakiCallReview, SakiCallResults } from "./SakiCallResults.js";
import type { SakiMessagesListProps } from "./SakiMessagesList.js";
import { SakiCallAvatar } from "./avatar/SakiCallAvatar.js";
import { createVideoCallMotion, type SakiPresentationTarget } from "./avatar/videoCallMotion.js";
import { isMobileCallDevice, SakiCallAudio, SakiCallModel, sakiCallSpeechParts, shouldDeferLocalVoiceModel } from "./sakiCallVoice.js";
import { useSakiCallMedia } from "./useSakiCallMedia.js";

type CallReply = { id: string; text: string; complete: boolean };
type CallStatus = Parameters<ConstructorParameters<typeof SakiCallModel>[1]>[0] | { phase: "idle"; source?: undefined; percent?: undefined };
const compactPresentationQuery = "(max-width: 740px), (max-aspect-ratio: 1/1)";

interface SakiTaskCallProps {
  visible: boolean;
  audio: SakiCallAudio;
  token: string;
  language: string;
  workspace: string;
  workspaceId: string | undefined;
  workspaces: Array<{ id: string; name: string }>;
  conversation: SakiMessagesListProps;
  taskProgress: ReactNode;
  taskNotice: string | null;
  attachmentPreview: ReactNode;
  modelId: string;
  modelName: string;
  models: SakiModelOption[];
  modelPointsMultipliers: SakiModelPointsMultiplierMap;
  busy: boolean;
  decisionAction: SakiAgentAction | undefined;
  reply: CallReply | null;
  onSend: (text: string, frame?: SakiInputAttachment) => Promise<void>;
  onSelectModel: (modelId: string) => void;
  onOpenConversation: () => void;
  onOpenArtifact: ((path: string, workspaceId: string) => void) | undefined;
  onChooseWorkspace: (() => void) | undefined;
  onEnd: () => void;
}

export function SakiTaskCall({
  visible, audio, token, language, workspace, workspaceId, workspaces, conversation, taskProgress, taskNotice, attachmentPreview,
  modelId, modelName, models, modelPointsMultipliers,
  busy, decisionAction, reply, onSend, onSelectModel, onOpenConversation, onOpenArtifact, onChooseWorkspace, onEnd
}: SakiTaskCallProps) {
  const zh = language.startsWith("zh");
  const copy = (cn: string, en: string) => zh ? cn : en;
  const languageTag = language || navigator.language;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [headerPanel, setHeaderPanel] = useState<"model" | "tasks" | null>(null);
  const modelPickerId = useId();
  const tasksId = useId();
  const modelAnchorRef = useRef<HTMLDivElement>(null);
  const modelToggleRef = useRef<HTMLButtonElement>(null);
  const tasksToggleRef = useRef<HTMLButtonElement>(null);
  const lastFullscreenExit = useRef(-Infinity);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const media = useSakiCallMedia(visible);
  const [motion] = useState(createVideoCallMotion);
  const [compactPresentation, setCompactPresentation] = useState(() => window.matchMedia(compactPresentationQuery).matches);
  const [presentedTarget, setPresentedTarget] = useState<SakiPresentationTarget>(0);
  const [dismissedPanel, setDismissedPanel] = useState("");
  const awaitingDecision = Boolean(decisionAction);
  const canPresent = visible && headerPanel !== "tasks";
  const stagedDecision = canPresent ? decisionAction : undefined;
  const completedMessage = canPresent && !awaitingDecision && !busy && reply?.complete
    ? conversation.messages.find(message => message.id === reply.id)
    : undefined;
  const interruption = useMemo(() => completedMessage && completedMessage.id !== conversation.dismissedRetryId
    ? getSakiCallInterruption(completedMessage) : null, [completedMessage, conversation.dismissedRetryId]);
  const review = useMemo(() => completedMessage && !interruption
    ? getSakiCallReview(completedMessage, conversation.changesSummary, workspaceId, workspaces)
    : null, [completedMessage, interruption, conversation.changesSummary, workspaceId, workspaces]);
  const panelKind = interruption ? "interruption" : review?.artifacts.length || review?.changes ? "review" : null;
  const panelKey = completedMessage && panelKind ? `${completedMessage.id}:${panelKind}` : "";
  const showSupplement = Boolean(panelKey && panelKey !== dismissedPanel);
  const showStagePanel = Boolean(stagedDecision || showSupplement);
  const decisionSide = compactPresentation ? "bottom" : media.source ? "left" : "right";
  const sidebarApproval = visible && headerPanel === "tasks" && awaitingDecision && !compactPresentation;
  const presentationTarget: SakiPresentationTarget = sidebarApproval ? -1 : !showStagePanel ? 0
    : decisionSide === "bottom" ? "center" : decisionSide === "left" ? 1 : -1;
  const showPanel = showStagePanel && (compactPresentation || presentedTarget === presentationTarget);
  const [mobileCall] = useState(isMobileCallDevice);
  const [deferModel] = useState(shouldDeferLocalVoiceModel);
  const [modelRequested, setModelRequested] = useState(() => !deferModel);
  const [switchModelWhenReady, setSwitchModelWhenReady] = useState(false);
  const [modelStatus, setModelStatus] = useState<CallStatus>(() => ({ phase: deferModel ? "idle" : "selecting" }));
  const [modelAttempt, setModelAttempt] = useState(0);
  const [engine, setEngine] = useState<"model" | "browser">(() => deferModel ? "browser" : "model");
  const [outputMuted, setOutputMuted] = useState(false);
  const [micEnabled, setMicEnabled] = useState(() => Boolean(getSpeechRecognitionConstructor()) && !mobileCall);
  const [micReady, setMicReady] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [lastTurn, setLastTurn] = useState("");
  const [text, setText] = useState("");
  const [textInputOpen, setTextInputOpen] = useState(() => !getSpeechRecognitionConstructor());
  const textFormId = useId();
  const textToggleRef = useRef<HTMLButtonElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const shouldFocusTextRef = useRef(false);
  const [micError, setMicError] = useState("");
  const [frameError, setFrameError] = useState(false);
  const [outputError, setOutputError] = useState(false);
  const [sending, setSending] = useState(false);
  const captionRef = useRef<HTMLDivElement>(null);
  const captionsFollowRef = useRef(true);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const restartTimer = useRef<number | undefined>(undefined);
  const shortSessions = useRef(0);
  const modelRef = useRef<SakiCallModel | null>(null);
  const sendingRef = useRef(false);
  const speech = useRef({ id: reply?.id, cursor: reply?.complete ? sakiCallSpeechParts(reply.text, true).length : 0,
    queue: [] as string[], running: false, version: 0, skippedId: "" });
  const settings = useRef({ engine, languageTag });
  settings.current = { engine, languageTag };
  const baseline = useRef(reply?.complete ? reply : null);
  const started = engine === "browser" || modelStatus.phase === "ready";
  const blocked = busy || sending || awaitingDecision;
  const canListen = visible && started && micEnabled && !blocked && !speaking;
  const canListenRef = useRef(canListen);
  canListenRef.current = canListen;

  useEffect(() => {
    const query = window.matchMedia(compactPresentationQuery);
    const sync = () => setCompactPresentation(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!textInputOpen || !shouldFocusTextRef.current) return;
    shouldFocusTextRef.current = false;
    textInputRef.current?.focus();
  }, [textInputOpen]);

  useLayoutEffect(() => {
    motion.present(presentationTarget);
  }, [motion, presentationTarget]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const surface = surfaceRef.current;
    if (!visible || !dialog || !surface) return;
    const viewport = window.visualViewport;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    let stableWidth = 0;
    let stableHeight = 0;
    const syncViewport = () => {
      if (!viewport || Math.abs(viewport.scale - 1) > 0.05) return;
      dialog.style.setProperty("--saki-call-height", viewport.height + "px");
      dialog.style.setProperty("--saki-call-top", viewport.offsetTop + "px");
      if (coarse) {
        const width = Math.round(viewport.width);
        const fullHeight = Math.max(viewport.height, window.innerHeight);
        if (Math.abs(width - stableWidth) > 24 || fullHeight > stableHeight) {
          stableWidth = width;
          stableHeight = fullHeight;
        }
        dialog.style.setProperty("--saki-call-scene-height", stableHeight + "px");
      } else {
        dialog.style.removeProperty("--saki-call-scene-height");
      }
    };
    let wasFullscreen = false;
    const syncFullscreen = () => {
      const active = document.fullscreenElement === surface;
      if (wasFullscreen && !active) lastFullscreenExit.current = performance.now();
      wasFullscreen = active;
      setFullscreen(active);
    };
    syncViewport();
    syncFullscreen();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    document.addEventListener("fullscreenchange", syncFullscreen);
    dialog.showModal();
    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      document.removeEventListener("fullscreenchange", syncFullscreen);
      if (document.fullscreenElement === surface) void document.exitFullscreen().catch(() => {});
      dialog.close();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || headerPanel !== "model") return;
    function dismissModelPicker(event: PointerEvent) {
      if (event.target instanceof Node && !modelAnchorRef.current?.contains(event.target)) {
        setHeaderPanel((current) => current === "model" ? null : current);
      }
    }
    document.addEventListener("pointerdown", dismissModelPicker);
    return () => document.removeEventListener("pointerdown", dismissModelPicker);
  }, [visible, headerPanel]);

  function closeHeaderPanel() {
    setHeaderPanel(null);
    (headerPanel === "model" ? modelToggleRef : tasksToggleRef).current?.focus();
  }

  async function toggleFullscreen() {
    const surface = surfaceRef.current;
    if (!surface) return;
    setFullscreenError(false);
    try {
      if (document.fullscreenElement === surface) await document.exitFullscreen();
      else await surface.requestFullscreen();
    } catch {
      setFullscreenError(true);
    }
  }

  useEffect(() => {
    if (!modelRequested) {
      modelRef.current = null;
      setModelStatus({ phase: "idle" });
      return;
    }
    setModelStatus({ phase: "selecting" });
    const model = new SakiCallModel(token, setModelStatus);
    modelRef.current = model;
    return () => {
      modelRef.current = null;
      model.close();
    };
  }, [modelAttempt, modelRequested, token]);

  useEffect(() => {
    if (!switchModelWhenReady) return;
    if (modelStatus.phase === "ready") {
      setSwitchModelWhenReady(false);
      setEngine("model");
    } else if (modelStatus.phase === "error") {
      setSwitchModelWhenReady(false);
    }
  }, [modelStatus.phase, switchModelWhenReady]);

  useEffect(() => () => {
    speech.current.version += 1;
    audio.stop();
  }, [audio]);

  function stopRecognition() {
    window.clearTimeout(restartTimer.current);
    setMicReady(false);
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognitionRef.current = null;
    recognition.onend = null;
    recognition.onresult = null;
    recognition.onerror = null;
    try { recognition.abort(); } catch {}
  }

  function silence(skipReply: boolean) {
    const session = speech.current;
    session.version += 1;
    session.queue.length = 0;
    session.running = false;
    if (skipReply) session.skippedId = reply?.id ?? "";
    audio.stop();
    setSpeaking(false);
  }

  async function send(value: string) {
    const instruction = value.trim();
    if (!visible || !instruction || !started || blocked || sendingRef.current) return;
    let frame: SakiInputAttachment | undefined;
    if (media.attachFrame) {
      try { frame = media.capture(); }
      catch {
        setFrameError(true);
        setText(instruction);
        return;
      }
    }
    sendingRef.current = true;
    stopRecognition();
    if (mobileCall) setMicEnabled(false);
    if (modelStatus.phase === "error") setModelRequested(false);
    silence(true);
    setSending(true);
    setLastTurn(instruction);
    motion.command(instruction);
    captionsFollowRef.current = true;
    setTranscript("");
    setText("");
    setFrameError(false);
    if (frame) media.setAttachFrame(false);
    try { await onSend(instruction, frame); }
    catch { setText(instruction); }
    finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  const sendRef = useRef(send);
  sendRef.current = send;

  function listen() {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition || recognitionRef.current) return;
    const recognition = new Recognition();
    let interim = "";
    const startTime = Date.now();
    recognitionRef.current = recognition;
    recognition.lang = settings.current.languageTag;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.addEventListener("audiostart", () => {
      if (recognitionRef.current === recognition) setMicReady(true);
    }, { once: true });
    recognition.onresult = ({ results }) => {
      if (recognitionRef.current !== recognition || !canListenRef.current) return;
      const rows = Array.from(results);
      const final = rows.filter((entry) => entry.isFinal).map((entry) => entry[0]?.transcript ?? "").join(" ").trim();
      interim = rows.filter((entry) => !entry.isFinal).map((entry) => entry[0]?.transcript ?? "").join(" ").trim();
      setTranscript(final || interim);
      if (final) void sendRef.current(final);
    };
    recognition.onerror = ({ error }) => {
      if (recognitionRef.current !== recognition || error === "no-speech" || error === "aborted") return;
      stopRecognition();
      if (interim) setText((current) => current || interim);
      setMicError(error || "unavailable");
      setMicEnabled(false);
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setMicReady(false);
      if (interim) setText((current) => current || interim);
      setTranscript("");
      if (mobileCall) {
        setMicEnabled(false);
        return;
      }
      shortSessions.current = Date.now() - startTime < 700 ? shortSessions.current + 1 : 0;
      if (shortSessions.current >= 4) {
        setMicError("unavailable");
        setMicEnabled(false);
      } else {
        restartTimer.current = window.setTimeout(() => {
          if (canListenRef.current) listen();
        }, shortSessions.current ? shortSessions.current * 300 : 160);
      }
    };
    try { recognition.start(); }
    catch {
      stopRecognition();
      setMicError("unavailable");
      setMicEnabled(false);
    }
  }
  const listenRef = useRef(listen);
  listenRef.current = listen;

  useEffect(() => {
    if (!canListen) {
      stopRecognition();
      setTranscript("");
      return;
    }
    if (mobileCall) return;
    shortSessions.current = 0;
    restartTimer.current = window.setTimeout(() => listenRef.current(), 280);
    return () => {
      stopRecognition();
      setTranscript("");
    };
  }, [canListen, languageTag, mobileCall]);

  useEffect(() => {
    if (!visible) silence(false);
  }, [visible, audio]);

  useEffect(() => {
    if (!reply) return;
    const session = speech.current;
    if (session.id !== reply.id) {
      session.id = reply.id;
      session.cursor = 0;
    }
    const parts = sakiCallSpeechParts(reply.text, reply.complete);
    const next = parts.slice(session.cursor);
    session.cursor = Math.max(session.cursor, parts.length);
    if (!visible || !started || outputMuted || session.skippedId === reply.id || next.length === 0) return;
    session.queue.push(...next);
    if (session.running) return;
    session.running = true;
    const version = session.version;
    const current = () => version === session.version;
    stopRecognition();
    setSpeaking(true);
    void (async () => {
      try {
        let part: string | undefined;
        while (current() && (part = session.queue.shift())) {
          const { engine: voice, languageTag: lang } = settings.current;
          if (voice === "model") {
            try {
              const samples = await modelRef.current?.generate(part);
              if (!current()) return;
              if (!samples) throw new Error("Voice model unavailable");
              await audio.play(samples, part);
              continue;
            } catch {
              if (!current()) return;
              settings.current.engine = "browser";
              setEngine("browser");
            }
          }
          const partLanguage = /\p{Script=Han}/u.test(part) && !lang.startsWith("zh") ? "zh-CN"
            : !/\p{Script=Han}/u.test(part) && lang.startsWith("zh") ? "en-US" : lang;
          await audio.speak(part, partLanguage);
        }
      } catch {
        if (!current()) return;
        session.queue.length = 0;
        setOutputError(true);
        setOutputMuted(true);
      } finally {
        if (current()) {
          session.running = false;
          setSpeaking(false);
        }
      }
    })();
  }, [audio, outputMuted, reply, started, visible]);

  function toggleMic() {
    setMicError("");
    audio.unlock();
    if (speaking) {
      silence(true);
      setMicEnabled(true);
      if (mobileCall && !busy && !sendingRef.current && !awaitingDecision) {
        canListenRef.current = true;
        listen();
      }
      return;
    }
    if (micEnabled) {
      stopRecognition();
      setMicEnabled(false);
      return;
    }
    setMicEnabled(true);
    if (!blocked) {
      canListenRef.current = true;
      listen();
    }
  }

  function handleVoiceToggle() {
    audio.unlock();
    silence(true);
    setOutputError(false);
    setOutputMuted(false);
    if (engine === "model") {
      setEngine("browser");
      return;
    }
    if (modelStatus.phase === "ready") {
      setEngine("model");
      return;
    }
    if (modelRequested && modelStatus.phase !== "error" && modelStatus.phase !== "idle") {
      setModelRequested(false);
      setSwitchModelWhenReady(false);
      return;
    }
    setModelRequested(true);
    setSwitchModelWhenReady(true);
    setModelAttempt((current) => current + 1);
  }

  const phase = modelStatus.phase;
  const sourceName = modelStatus.source === "mirror" ? copy("GitHub 镜像", "GitHub mirror") : "GitHub Releases";
  const preparing = phase === "downloading" ? copy(`正在通过 ${sourceName} 下载语音模型`, `Downloading voice model via ${sourceName}`)
    : phase === "connecting" ? copy(`正在连接 ${sourceName}`, `Connecting to ${sourceName}`)
    : phase === "verifying" ? copy("正在校验语音模型", "Verifying voice model")
    : phase === "initializing" ? copy("正在启动语音引擎", "Starting the voice engine")
    : copy("正在按 IP 选择下载线路", "Selecting a download route by IP");
  const modelLoadingInBackground = started && engine === "browser" && modelRequested && phase !== "ready" && phase !== "error" && phase !== "idle";
  const modelBackgroundError = started && engine === "browser" && modelRequested && phase === "error";
  const caption = reply && (reply.id !== baseline.current?.id || reply.text !== baseline.current.text) ? reply.text : "";
  useLayoutEffect(() => {
    const element = captionRef.current;
    if (element && captionsFollowRef.current) element.scrollTop = element.scrollHeight;
  }, [caption, captions, lastTurn, transcript]);
  const micAvailable = Boolean(getSpeechRecognitionConstructor());
  const canShareScreen = Boolean(navigator.mediaDevices?.getDisplayMedia);
  const micListening = started && micReady && !blocked && !speaking;
  const micLabel = speaking ? copy("打断并说话", "Interrupt and talk")
    : micListening ? (mobileCall
      ? copy("正在听，说完自动发送（点击停止）", "Listening · sends when you finish (tap to stop)")
      : copy("正在听，说完自动发送（点击关闭麦克风）", "Listening · sends when you finish (click to mute)"))
    : micEnabled ? copy("关闭麦克风", "Mute microphone")
    : mobileCall ? copy("点击说话", "Tap to speak") : copy("打开麦克风", "Enable microphone");
  const voiceToggleLabel = engine === "model"
    ? copy("Saki 音色（点击切换为浏览器语音）", "Saki voice (click for browser voice)")
    : phase === "ready" ? copy("浏览器语音（点击切换为 Saki 音色）", "Browser voice (click for Saki voice)")
    : modelLoadingInBackground ? copy("正在准备 Saki 音色（点击取消）", "Preparing Saki voice (tap to cancel)")
    : copy("浏览器语音（点击加载 Saki 音色，约 132 MiB）", "Browser voice (tap to load Saki voice, ~132 MiB)");
  const callTitle = copy("任务视频通话", "Task video call");
  const fullscreenLabel = fullscreen ? copy("退出浏览器全屏", "Exit browser fullscreen") : copy("浏览器全屏", "Browser fullscreen");
  const textToggleLabel = textInputOpen ? copy("收起文字输入", "Hide text input") : copy("展开文字输入", "Show text input");
  const showUnavailableMicNotice = !micAvailable && !textInputOpen;
  const showDockError = Boolean(micError || showUnavailableMicNotice || outputError || media.error || frameError || modelBackgroundError);

  return createPortal(
    <dialog className="saki-task-call-dialog" ref={dialogRef} aria-label={callTitle}
      onCancel={(event) => {
        event.preventDefault();
        if (attachmentPreview) return;
        if (document.fullscreenElement === surfaceRef.current) {
          void toggleFullscreen();
          return;
        }
        if (performance.now() - lastFullscreenExit.current <= 350) return;
        if (headerPanel) {
          closeHeaderPanel();
        } else if (textInputOpen) {
          setTextInputOpen(false);
          textToggleRef.current?.focus();
        } else if (showSupplement) {
          setDismissedPanel(panelKey);
        } else onEnd();
      }}>
      <div className="saki-task-call" ref={surfaceRef}>
        <div className="saki-task-call-scene" data-i18n-skip>
          <SakiCallAvatar audio={audio} motion={motion} language={language} turnId={reply?.id} heard={Boolean(transcript)}
            compact={compactPresentation} presentationTarget={presentationTarget} onPresentedChange={setPresentedTarget}
            phase={!started || awaitingDecision ? "idle" : (busy || sending || speaking) ? "thinking" : micReady ? "listening" : "idle"} />
        </div>
        <header className="saki-task-call-header" data-i18n-skip>
          <div className="saki-task-call-model" ref={modelAnchorRef}>
            <LiquidGlassContainer className="saki-task-call-identity-glass" mode="shader" cornerRadius={999} blurAmount={0}>
              <div className="saki-task-call-identity">
                <button type="button" className="saki-task-call-model-toggle" ref={modelToggleRef}
                  aria-expanded={headerPanel === "model"} aria-controls={headerPanel === "model" ? modelPickerId : undefined}
                  onClick={() => setHeaderPanel((current) => current === "model" ? null : "model")}>
                  <strong title={modelName}>{modelName || copy("选择模型", "Select model")}</strong><ChevronDown size={13} aria-hidden="true" />
                </button>
                <small title={workspace}>{workspace}</small>
              </div>
            </LiquidGlassContainer>
            {visible && headerPanel === "model" ? (
              <div id={modelPickerId} className="saki-task-call-model-picker saki-reasoning-panel">
                <SakiModelList models={models} currentModelId={modelId} language={language} modelPointsMultipliers={modelPointsMultipliers}
                  onSelectModel={(nextModelId) => { onSelectModel(nextModelId); closeHeaderPanel(); }} />
              </div>
            ) : null}
          </div>
          <LiquidGlassContainer className="saki-task-call-actions-glass" mode="shader" cornerRadius={999} blurAmount={0}>
            <div className="saki-task-call-header-actions">
              {started ? (
                <button type="button" className="saki-task-call-voice" title={voiceToggleLabel} aria-label={voiceToggleLabel}
                  aria-pressed={engine === "model"} aria-busy={modelLoadingInBackground || undefined}
                  data-pending={modelLoadingInBackground ? "true" : undefined}
                  onClick={handleVoiceToggle}>
                  {engine === "model" ? <Sparkles size={16} /> : <Globe size={16} />}
                </button>
              ) : null}
              <button type="button" className="saki-task-call-tasks" ref={tasksToggleRef} data-pending={awaitingDecision}
                aria-label={copy("查看任务", "View tasks")} aria-expanded={headerPanel === "tasks"}
                aria-controls={headerPanel === "tasks" ? tasksId : undefined}
                onClick={() => setHeaderPanel((current) => current === "tasks" ? null : "tasks")}>
                <ClipboardList size={16} /><span>{copy("查看任务", "View tasks")}</span>
              </button>
              {document.fullscreenEnabled ? (
                <button type="button" aria-label={fullscreenLabel} title={fullscreenLabel} aria-pressed={fullscreen} onClick={() => void toggleFullscreen()}>
                  {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
                </button>
              ) : null}
            </div>
          </LiquidGlassContainer>
        </header>
        <div className="saki-task-call-stage" data-decision-side={sidebarApproval ? "right" : showStagePanel ? decisionSide : undefined}>
          <div className={`saki-task-call-preview ${media.source ? "has-preview" : ""}`}
            data-source={media.source ?? undefined}
            data-orientation={media.portrait ? "portrait" : "landscape"}
            data-mirror={media.source === "camera" && media.facingMode === "user" ? "true" : undefined}>
            <video ref={media.videoRef} muted playsInline autoPlay aria-label={copy("本地视频预览", "Local video preview")} />
            {media.source === "camera" && media.canFlipCamera ? (
              <button type="button" className="saki-task-call-flip-camera"
                title={copy("切换前后摄像头", "Switch camera")} aria-label={copy("切换前后摄像头", "Switch camera")}
                disabled={media.pending} onClick={() => { setFrameError(false); void media.flipCamera(); }}>
                <SwitchCamera size={15} />
              </button>
            ) : null}
          </div>
          {started && captions && (lastTurn || transcript || caption) ? (
            <div className="saki-task-call-captions" ref={captionRef} onScroll={(event) => {
              const element = event.currentTarget;
              captionsFollowRef.current = element.scrollHeight - element.clientHeight - element.scrollTop < 20;
            }}>
              {lastTurn || transcript ? <p>{transcript || lastTurn}</p> : null}
              {caption ? <MarkdownContent content={caption} /> : null}
            </div>
          ) : null}
          {showPanel && stagedDecision ? (
            <aside className="saki-task-call-decision" aria-label={copy("等待你的选择", "Waiting for your decision")}>
              {stagedDecision.status === "pending_approval" ? (
                <h2 className="saki-task-call-decision-title">{copy("任务需要审批", "Task requires approval")}</h2>
              ) : null}
              <SakiToolActionCard key={stagedDecision.id} action={stagedDecision} actionBusyId={conversation.actionBusyId}
                defaultExpanded onDecision={conversation.onDecideAction} onAnswer={conversation.onAnswerQuestion}
                onOpenPath={conversation.onOpenPath} />
              {stagedDecision.status === "pending_approval" && taskNotice ? (
                <p className="saki-task-call-task-note" role="status">{taskNotice}</p>
              ) : null}
            </aside>
          ) : null}
          {showPanel && showSupplement && completedMessage ? (
            <aside className="saki-task-call-decision" aria-labelledby={`${tasksId}-presentation`}>
              <header className="saki-call-presentation-heading">
                <h2 className="saki-task-call-decision-title" id={`${tasksId}-presentation`}>
                  {interruption ? copy("任务中断", "Task interrupted")
                    : review?.artifacts.length ? copy("任务成果", "Task outputs")
                    : copy("代码改动", "Code changes")}
                </h2>
                <button className="small-button" type="button" aria-label={copy("关闭卡片", "Close card")} onClick={() => setDismissedPanel(panelKey)}><X size={16} /></button>
              </header>
              {interruption ? <div className="saki-call-results">
                <p role="status">{interruption.reason}</p>
                <div className="saki-call-artifact-actions">
                  {interruption.resumable && conversation.onRetryAssistantTurn ? (
                    <button className="small-button" type="button" onClick={() => void conversation.onRetryAssistantTurn?.(completedMessage.id)}>
                      {copy("重试", "Retry")}
                    </button>
                  ) : null}
                  <button className="small-button" type="button" onClick={() => setHeaderPanel("tasks")}>{copy("查看执行记录", "View task log")}</button>
                  {onChooseWorkspace ? <button className="small-button" type="button" onClick={onChooseWorkspace}>{copy("选择工作区", "Choose workspace")}</button> : null}
                </div>
              </div> : review ? <SakiCallResults key={panelKey} review={review} conversation={conversation} copy={copy} onOpenArtifact={onOpenArtifact} /> : null}
            </aside>
          ) : null}
          {visible && headerPanel === "tasks" ? (
            <SakiCallTasksSidebar id={tasksId} token={token} language={language} conversation={conversation}
              progress={taskProgress} notice={taskNotice}
              onClose={closeHeaderPanel} onOpenConversation={() => { setHeaderPanel(null); onOpenConversation(); }} />
          ) : null}
        </div>
        <footer className="saki-task-call-footer" data-text-open={started && textInputOpen} data-i18n-skip>
          <LiquidGlassContainer className="saki-task-call-glass" mode="shader" cornerRadius={26} blurAmount={0}>
            <div className="saki-task-call-dock">
              {fullscreenError ? <p className="saki-task-call-error" role="status">{copy("浏览器暂时无法进入全屏。", "The browser could not enter fullscreen.")}</p> : null}
              {!started ? (
                <div className="saki-task-call-setup">
                  {phase === "error" ? (
                    <>
                      <p role="alert">{window.isSecureContext
                        ? copy("语音模型下载或启动失败。", "Could not download or start the voice model.")
                        : copy("本地语音模型需要 HTTPS 或 localhost。", "The local voice model requires HTTPS or localhost.")}</p>
                      <button type="button" onClick={() => {
                        audio.unlock();
                        setModelRequested(true);
                        setModelAttempt((current) => current + 1);
                      }}>{copy("重试", "Retry")}</button>
                      <button type="button" onClick={() => {
                        audio.unlock();
                        setModelRequested(false);
                        setSwitchModelWhenReady(false);
                        setEngine("browser");
                      }}>
                        {copy("使用浏览器语音", "Use browser voice")}
                      </button>
                    </>
                  ) : (
                    <div role="status">
                      <p>{preparing}</p>
                      {phase === "downloading" ? <progress aria-label={preparing} max={100} value={modelStatus.percent ?? 0} /> : null}
                      <small>{phase === "downloading" ? `${modelStatus.percent ?? 0}% · ` : ""}{copy("约 132 MiB，准备完成后自动接通", "About 132 MiB · connects when ready")}</small>
                      <div className="saki-task-call-setup-actions">
                        <button type="button" onClick={() => {
                          audio.unlock();
                          setModelRequested(false);
                          setSwitchModelWhenReady(false);
                          setEngine("browser");
                        }}>
                          {copy("先用浏览器语音", "Use browser voice now")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {modelLoadingInBackground ? (
                    <div className="saki-task-call-voice-progress" role="status">
                      <div className="saki-task-call-voice-progress-row">
                        <span>{preparing}{phase === "downloading" ? ` · ${modelStatus.percent ?? 0}%` : ""}</span>
                        <button type="button" onClick={() => {
                          setModelRequested(false);
                          setSwitchModelWhenReady(false);
                        }}>{copy("取消", "Cancel")}</button>
                      </div>
                      {phase === "downloading" ? <progress aria-label={preparing} max={100} value={modelStatus.percent ?? 0} /> : null}
                    </div>
                  ) : null}
                  {showDockError ? (
                    <p className="saki-task-call-error" role="alert">
                      {showUnavailableMicNotice ? copy("浏览器不支持语音识别，可点键盘输入。", "Speech recognition is unavailable. Use the keyboard button to type.")
                        : micError === "not-allowed" || micError === "service-not-allowed" ? copy("请允许浏览器使用麦克风，然后重新开启。", "Allow microphone access, then enable it again.")
                        : micError ? copy("语音识别暂不可用。可重开麦克风或输入文字。", "Speech recognition is temporarily unavailable. Re-enable the microphone or type below.")
                        : outputError ? copy("语音播放失败。可以重新开启播报。", "Voice playback failed. You can re-enable it.")
                        : frameError ? copy("画面尚未就绪，请重试。", "The preview is still loading. Try again.")
                        : modelBackgroundError ? (window.isSecureContext
                          ? copy("Saki 音色模型加载失败，已保持浏览器语音。", "Could not load Saki voice. Staying on browser voice.")
                          : copy("本地语音模型需要 HTTPS 或 localhost。", "The local voice model requires HTTPS or localhost."))
                        : copy("无法打开摄像头或共享屏幕。", "Could not open the camera or screen share.")}
                    </p>
                  ) : null}
                  {textInputOpen ? (
                    <form id={textFormId} className="saki-task-call-input" onSubmit={(event) => { event.preventDefault(); audio.unlock(); void send(text); }}>
                      <input ref={textInputRef} value={text} onChange={(event) => setText(event.target.value)} aria-label={copy("输入任务指令", "Type a task instruction")}
                        placeholder={media.attachFrame ? copy("下句话将附上画面", "Next message includes a frame") : copy("也可以输入任务指令", "Type a task instruction")} />
                      <button type="submit" aria-label={copy("发送任务指令", "Send task instruction")} disabled={blocked || !text.trim()}><ArrowRight size={16} /></button>
                    </form>
                  ) : null}
                </>
              )}
              <div className="saki-task-call-controls" role="toolbar" aria-label={copy("通话控制", "Call controls")}>
                {started ? (
                  <>
                    <button type="button" className="saki-task-call-mic" data-listening={micListening ? "true" : undefined} title={micLabel} aria-label={micLabel} aria-pressed={micEnabled} disabled={!micAvailable} onClick={toggleMic}>
                      {micEnabled ? <Mic size={17} /> : <MicOff size={17} />}
                    </button>
                    <button type="button" ref={textToggleRef} title={textToggleLabel} aria-label={textToggleLabel}
                      aria-expanded={textInputOpen} aria-controls={textInputOpen ? textFormId : undefined}
                      onClick={() => {
                        setTextInputOpen((open) => {
                          if (!open) shouldFocusTextRef.current = true;
                          return !open;
                        });
                      }}><Keyboard size={17} /></button>
                    <button type="button" title={copy("摄像头", "Camera")} aria-label={copy("摄像头", "Camera")} aria-pressed={media.source === "camera"}
                      disabled={media.pending || !navigator.mediaDevices?.getUserMedia} onClick={() => { setFrameError(false); void media.toggle("camera"); }}>
                      {media.source === "camera" ? <Video size={17} /> : <VideoOff size={17} />}
                    </button>
                    {canShareScreen ? (
                      <button type="button" title={copy("共享屏幕", "Share screen")} aria-label={copy("共享屏幕", "Share screen")} aria-pressed={media.source === "screen"}
                        disabled={media.pending} onClick={() => { setFrameError(false); void media.toggle("screen"); }}><Monitor size={17} /></button>
                    ) : null}
                    {media.source ? (
                      <button type="button" title={copy("随下一条消息发送一帧画面", "Attach a frame to the next message")}
                        aria-label={copy("随下一条消息发送一帧画面", "Attach a frame to the next message")} aria-pressed={media.attachFrame}
                        onClick={() => { setFrameError(false); media.setAttachFrame(!media.attachFrame); }}><ScanLine size={17} /></button>
                    ) : null}
                    <button type="button" title={copy("切换语音播报", "Toggle spoken replies")} aria-label={copy("切换语音播报", "Toggle spoken replies")} aria-pressed={!outputMuted}
                      onClick={() => { audio.unlock(); setOutputError(false); if (!outputMuted) silence(true); setOutputMuted(!outputMuted); }}>
                      {outputMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                    </button>
                    <button type="button" title={copy("字幕", "Captions")} aria-label={copy("字幕", "Captions")} aria-pressed={captions}
                      onClick={() => setCaptions(!captions)}><Captions size={17} /></button>
                  </>
                ) : null}
                <button type="button" className="saki-task-call-end" title={copy("结束视频通话", "End video call")}
                  aria-label={copy("结束视频通话", "End video call")} onClick={onEnd}><PhoneOff size={17} /></button>
              </div>
            </div>
          </LiquidGlassContainer>
        </footer>
        {attachmentPreview}
      </div>
    </dialog>,
    document.body
  );
}
