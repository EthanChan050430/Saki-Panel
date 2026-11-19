const releaseAsset = "https://github.com/EthanChan050430/Saki-AI/releases/download/tts-model-v1/sherpa-onnx-wasm-main-tts.data";

export const sakiCallVoiceModel = {
  size: 138068830,
  sha256: "2fc20c60263d89c146fa3a71336d9c6d9bd62d57caa44f10e1f1a764e4149392",
  urls: {
    github: releaseAsset,
    mirror: `https://gh-proxy.org/${releaseAsset}`
  }
} as const;

export const sakiCallVoiceDownloadPath = "/api/saki/call-voice/model";
