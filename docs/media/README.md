# Saki Panel 5.0 README media

The English and Chinese README posters combine real application screenshots with a decorative background generated using the built-in ImageGen tool. No UI was generated or repainted. The screenshot is placed at its original 1728 × 1100 pixel size inside each 2048 × 1536 poster.

## Files

- `../../.github/assets/poster-v5-en.png` — English poster.
- `../../.github/assets/poster-v5-zh.png` — Chinese poster.
- `../../.github/assets/poster-v5-background.png` — generated background plate.
- `../../.github/assets/demo-v5-dashboard-{en,zh}.png` — original overview captures.
- `../../.github/assets/demo-v5-terminal-{en,zh}.png` — original instance console captures.
- `../../.github/assets/demo-v5-git-{en,zh}.png` — original Git workspace captures.
- `poster-v5.html` — editable composition; `?lang=en` or `?lang=zh` selects the language. Capture at a viewport of 2048 × 1536 with a device scale factor of 1 after fonts and images finish loading.

The captures show the released 5.0 interface from commit `bd4c917e265a887b84434fcea065724e3233e4a5`. Two actual Node.js demo processes run locally: an HTTP API and a background worker. The Git diff is a real change in the isolated demo repository. Prompts in the assistant inputs are drafts; they were not submitted to a model. The English captures retain the translations currently shipped by the application, including labels that are still in Chinese.

The demo runs from an isolated release directory. The main development database and saved provider credentials were not used.

An independent [incident walkthrough](../case-studies/port-recovery/README.md) now records actual model calls, approval, verification, and earlier failed attempts. Its screenshots and evidence are separate from the interface posters described here. It used an isolated runtime and an existing local Ollama model; its preparation also probed existing cloud connections. See the walkthrough for the tested code fixes and exact scope.

## ImageGen prompt

Mode: built-in ImageGen, opaque background. Reference inputs: the current Chinese dashboard screenshot and the existing Saki Panel app icon. The prompt below produced the background plate only; actual screenshots and exact bilingual typography are separate layers in the HTML composition.

```text
Use case: ads-marketing. Create one exceptionally refined product-poster BACKGROUND PLATE for Saki Panel 5.0. Landscape 4:3, 2048x1536 or larger equivalent. Reference image 1 is the REAL current product UI, supplied only to understand the product color and mood. Reference image 2 is the actual app icon, supplied only as palette reference. DO NOT draw, copy, invent, reconstruct or render any user interface, app window, screenshot, words, typography, letters, logo, icons, buttons or numbers. We will separately place the exact original screenshot and exact bilingual typography over this background, so this image must contain BACKGROUND ART ONLY. Art direction: premium software launch editorial, porcelain-white luminous paper / frosted opal glass, subtle cherry-blossom pink and glacial blue refractions, disciplined modern Japanese product design. The background should be mostly clean warm-white with natural fine paper grain; two abstract, sophisticated, translucent sculptural glass ribbons gently curve along the far left and far right outer edges and disappear beyond the frame. Very subtle pink/cyan caustic light near the margins and quiet diffuse studio shadows, no busy particles, no actual flowers, no anime figure, no fake dashboard. Central 86% width and center 73% height should be nearly empty pale white so our actual screenshot can be laid on top. Top 18% also clean for black headline typography. Bottom 7% clean for editorial captions. The image should feel designed and tactile, not a generic gradient wallpaper or neon cyberpunk poster. Restrained contrast, beautiful material detail at the edges only. No text anywhere, no watermark.
```

## Poster copy

English: “Servers. Code. One workspace.” / “AI assistance. Live metrics. Terminals. Git.”

Chinese: “运维与代码，同一个工作区。” / “AI 助手、实时监控、终端与 Git，一屏掌握。”
