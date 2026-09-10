import React from "react";
import { MarkdownContent } from "../../common/MarkdownContent.js";
import { parseThinkingContent, SakiThinkingActionCard } from "../SakiComponents.js";
import type { LocalSakiMessage } from "../sakiChatHelpers.js";
import { SakiChatGeneratedImages } from "./SakiChatImages.js";

export interface SakiMiniChatProps {
  messages: LocalSakiMessage[];
  loading: boolean;
  hasStreamingAssistant: boolean;
  thinkingGif: string;
  token?: string;
}

export const SakiMiniChat = React.memo(function SakiMiniChat({
  messages,
  loading,
  hasStreamingAssistant,
  thinkingGif,
  token
}: SakiMiniChatProps) {
  if (messages.length <= 1 && !loading) {
    return null;
  }

  return (
    <div className="saki-mini-chat-wrapper">
      <div className="saki-mini-chat">
        <div className="saki-mini-chat-inner">
          {messages
            .filter((m) => m.id !== "saki-welcome")
            .map((message) => {
              const parsed = parseThinkingContent(
                message.content,
                message.thinking,
                Boolean(message.streaming)
              );
              const hasThinking = Boolean(parsed.thinking);
              const hasAnswer = Boolean(parsed.answer.trim());
              const isThinkingStreaming = Boolean(message.streaming && !hasAnswer);

              return (
                <div
                  className={`saki-message saki-message-${message.role} mini-mode`}
                  key={message.id}
                >
                  {hasThinking ? (
                    <div className="saki-tool-timeline-item" style={{ margin: "2px 0 4px 0" }}>
                      <SakiThinkingActionCard
                        thinking={parsed.thinking}
                        streaming={isThinkingStreaming}
                        durationSec={message.thinkingDurationSec}
                      />
                    </div>
                  ) : null}
                  {hasAnswer ? (
                    <div className="saki-message-body">
                      {message.streaming ? (
                        <div className="saki-stream-raw-wrap">
                          <span className="saki-stream-raw">{parsed.answer}</span>
                          <span className="saki-stream-cursor" />
                        </div>
                      ) : (
                        <MarkdownContent content={parsed.answer} />
                      )}
                    </div>
                  ) : null}
                  {message.role === "assistant" && token ? (
                    <SakiChatGeneratedImages message={message} token={token} compact />
                  ) : null}
                  {!hasAnswer && !hasThinking && message.streaming ? (
                    <div className="saki-message-body">
                      <p className="saki-stream-placeholder">等待模型响应...</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          {loading && !hasStreamingAssistant && (
            <div className="saki-message saki-message-assistant mini-mode">
              <p className="saki-thinking-bubble">
                <img src={thinkingGif} alt="" />
                <span>思考中...</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
