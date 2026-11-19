import { useEffect, useRef, useState } from "react";
import type { SakiInputAttachment } from "@webops/shared";
import { newClientId } from "../../../utils/id.js";
import { sakiImageMaxDimension, sakiImageQuality } from "../sakiChatHelpers.js";
import { isMobileCallDevice } from "./sakiCallVoice.js";

type CallVideoSource = "camera" | "screen";
type CameraFacingMode = "user" | "environment";

export function useSakiCallMedia(visible: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sequence = useRef(0);
  const [source, setSource] = useState<CallVideoSource | null>(null);
  const [facingMode, setFacingMode] = useState<CameraFacingMode>("user");
  const [canFlipCamera, setCanFlipCamera] = useState(() => isMobileCallDevice());
  const [portrait, setPortrait] = useState(false);
  const [pending, setPending] = useState(false);
  const [attachFrame, setAttachFrame] = useState(false);
  const [error, setError] = useState(false);

  function release() {
    sequence.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function stop() {
    release();
    setSource(null);
    setPortrait(false);
    setAttachFrame(false);
    setPending(false);
  }

  useEffect(() => release, []);
  useEffect(() => {
    if (!visible) stop();
  }, [visible]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncOrientation = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setPortrait(video.videoHeight > video.videoWidth);
      }
    };
    video.addEventListener("loadedmetadata", syncOrientation);
    video.addEventListener("resize", syncOrientation);
    return () => {
      video.removeEventListener("loadedmetadata", syncOrientation);
      video.removeEventListener("resize", syncOrientation);
    };
  }, []);

  async function startStream(next: CallVideoSource, nextFacing: CameraFacingMode): Promise<boolean> {
    const id = sequence.current;
    setPending(true);
    try {
      const stream = next === "camera"
        ? await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: nextFacing } } })
        : await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
      if (id !== sequence.current || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      track?.addEventListener("ended", () => {
        if (id === sequence.current) stop();
      }, { once: true });
      await videoRef.current.play();
      if (id !== sequence.current) return false;
      if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
        setPortrait(videoRef.current.videoHeight > videoRef.current.videoWidth);
      }
      if (next === "camera") {
        const reportedFacing = track?.getSettings?.().facingMode;
        if (reportedFacing === "user" || reportedFacing === "environment") {
          setFacingMode(reportedFacing);
        } else {
          setFacingMode(nextFacing);
        }
        void navigator.mediaDevices.enumerateDevices?.()
          .then((devices) => {
            if (id !== sequence.current) return;
            const cameras = devices.filter((device) => device.kind === "videoinput");
            setCanFlipCamera(cameras.length > 1 || isMobileCallDevice());
          })
          .catch(() => {});
      }
      setSource(next);
      return true;
    } catch {
      if (id !== sequence.current) return false;
      stop();
      setError(true);
      return false;
    } finally {
      if (id === sequence.current) setPending(false);
    }
  }

  async function toggle(next: CallVideoSource) {
    const wasSame = source === next;
    stop();
    setError(false);
    if (wasSame) return;
    await startStream(next, facingMode);
  }

  async function flipCamera() {
    if (source !== "camera" || pending) return;
    const nextFacing: CameraFacingMode = facingMode === "user" ? "environment" : "user";
    const keepAttach = attachFrame;
    release();
    setError(false);
    const ok = await startStream("camera", nextFacing);
    if (ok) setAttachFrame(keepAttach);
  }

  function capture(): SakiInputAttachment {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error("Preview is not ready");
    const scale = Math.min(1, sakiImageMaxDimension / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not capture preview");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL("image/webp", sakiImageQuality);
    if (!dataUrl.startsWith("data:image/webp;")) {
      // iOS Safari does not encode image/webp and falls back to huge PNG; prefer JPEG.
      dataUrl = canvas.toDataURL("image/jpeg", sakiImageQuality);
    }
    const mimeType = dataUrl.startsWith("data:image/webp;")
      ? "image/webp"
      : dataUrl.startsWith("data:image/jpeg;")
        ? "image/jpeg"
        : "image/png";
    const ext = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
    return {
      id: newClientId(), kind: "screenshot", name: `call-${source ?? "frame"}.${ext}`,
      mimeType, dataUrl, width: canvas.width, height: canvas.height, size: Math.ceil(dataUrl.length * 0.75),
      capturedAt: new Date().toISOString()
    };
  }

  return { videoRef, source, facingMode, canFlipCamera, portrait, pending, attachFrame, setAttachFrame, error, toggle, flipCamera, capture };
}
