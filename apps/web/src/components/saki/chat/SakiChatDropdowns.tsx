import React from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  Check,
  CheckCircle2,
  Eye,
  ImageIcon,
  Paperclip,
  ScanEye,
  Shield,
  XOctagon
} from "lucide-react";
import {
  sakiListedModelSupportsVision,
  type SakiAgentPermissionMode,
  type SakiModelOption
} from "@webops/shared";
import {
  formatSakiModelMultiplier,
  resolveSakiModelPointsMultiplier,
  type SakiModelPointsMultiplierMap
} from "../sakiChatHelpers.js";

export interface SakiChatDropdownsProps {
  // Add menu
  sakiAddMenuOpen: boolean;
  sakiAddBtnRef: React.RefObject<HTMLButtonElement | null>;
  sakiAddMenuRef: React.RefObject<HTMLDivElement | null>;
  composerBusy: "image" | "file" | "screenshot" | null;
  onCloseAddMenu: () => void;
  onPasteImage: () => void;
  onUploadFile: () => void;
  onCaptureScreen: () => void;

  // Permission selector
  permissionDropdownOpen: boolean;
  permissionSelectorRef: React.RefObject<HTMLDivElement | null>;
  permissionDropdownRef: React.RefObject<HTMLDivElement | null>;
  permissionMode: SakiAgentPermissionMode;
  onSelectPermissionMode: (mode: SakiAgentPermissionMode) => void;

  // Model selector
  modelDropdownOpen: boolean;
  modelSelectorRef: React.RefObject<HTMLDivElement | null>;
  modelDropdownRef: React.RefObject<HTMLDivElement | null>;
  availableModels: SakiModelOption[];
  currentModelId: string;
  modelPointsMultipliers?: SakiModelPointsMultiplierMap;
  language: string;
  onSelectModel: (modelId: string) => void;
}

export const SakiChatDropdowns = React.memo(function SakiChatDropdowns({
  sakiAddMenuOpen,
  sakiAddBtnRef,
  sakiAddMenuRef,
  composerBusy,
  onCloseAddMenu,
  onPasteImage,
  onUploadFile,
  onCaptureScreen,
  permissionDropdownOpen,
  permissionSelectorRef,
  permissionDropdownRef,
  permissionMode,
  onSelectPermissionMode,
  modelDropdownOpen,
  modelSelectorRef,
  modelDropdownRef,
  availableModels,
  currentModelId,
  modelPointsMultipliers,
  language,
  onSelectModel
}: SakiChatDropdownsProps) {
  return (
    <>
      {sakiAddMenuOpen && sakiAddBtnRef.current
        ? createPortal(
            <div
              ref={sakiAddMenuRef}
              className="saki-add-menu"
              style={{
                position: "fixed",
                left: sakiAddBtnRef.current.getBoundingClientRect().left,
                bottom: window.innerHeight - sakiAddBtnRef.current.getBoundingClientRect().top + 6
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="saki-add-menu-item"
                type="button"
                disabled={composerBusy !== null}
                onClick={() => {
                  onCloseAddMenu();
                  onPasteImage();
                }}
              >
                <ImageIcon size={16} />
                <span>粘贴图片</span>
              </button>
              <button
                className="saki-add-menu-item"
                type="button"
                disabled={composerBusy !== null}
                onClick={() => {
                  onCloseAddMenu();
                  onUploadFile();
                }}
              >
                <Paperclip size={16} />
                <span>上传文件</span>
              </button>
              <button
                className="saki-add-menu-item"
                type="button"
                disabled={composerBusy !== null}
                onClick={() => {
                  onCloseAddMenu();
                  onCaptureScreen();
                }}
              >
                <Camera size={16} />
                <span>网页截图</span>
              </button>
            </div>,
            document.body
          )
        : null}

      {permissionDropdownOpen && permissionSelectorRef.current
        ? createPortal(
            <div
              ref={permissionDropdownRef}
              className="saki-model-dropdown saki-permission-dropdown glass-panel"
              style={{
                position: "fixed",
                left: permissionSelectorRef.current.getBoundingClientRect().left,
                bottom: window.innerHeight - permissionSelectorRef.current.getBoundingClientRect().top + 8
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="saki-dropdown-title">智能体权限模式</div>
              {(
                [
                  { id: "acceptEdits", label: "自动接受", desc: "自动执行安全文件编辑", icon: CheckCircle2, colorClass: "accept" },
                  { id: "ask", label: "询问确认", desc: "每次文件修改均需确认", icon: Shield, colorClass: "ask" },
                  { id: "plan", label: "仅规划", desc: "只输出执行方案，不落盘修改", icon: Eye, colorClass: "plan" },
                  { id: "bypassPermissions", label: "跳过审查", desc: "绕过所有确认全速自动执行", icon: XOctagon, colorClass: "bypass" }
                ] as const
              ).map((opt) => {
                const IconComponent = opt.icon;
                const isActive = permissionMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    className={`saki-perm-dropdown-option ${isActive ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      onSelectPermissionMode(opt.id);
                    }}
                  >
                    <div className={`perm-opt-icon ${opt.colorClass}`}>
                      <IconComponent size={15} />
                    </div>
                    <div className="perm-opt-text">
                      <div className="perm-opt-label">{opt.label}</div>
                      <div className="perm-opt-desc">{opt.desc}</div>
                    </div>
                    {isActive ? <Check size={14} className="perm-opt-check" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}

      {modelDropdownOpen && modelSelectorRef.current
        ? createPortal(
            <div
              ref={modelDropdownRef}
              className="saki-model-dropdown"
              style={{
                position: "fixed",
                left: modelSelectorRef.current.getBoundingClientRect().left,
                bottom: window.innerHeight - modelSelectorRef.current.getBoundingClientRect().top + 8
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {availableModels.map((model) => {
                const supportsVision = sakiListedModelSupportsVision(model);
                const multiplier = resolveSakiModelPointsMultiplier(modelPointsMultipliers, model);
                const isEn = language === "en-US";
                const isTw = language === "zh-TW";
                const multiplierText =
                  multiplier === 0
                    ? isEn ? "Free" : isTw ? "免費" : "免费"
                    : formatSakiModelMultiplier(multiplier);
                return (
                  <button
                    key={model.id}
                    className={`saki-model-option ${model.id === currentModelId ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      onSelectModel(model.id);
                    }}
                  >
                    <span className="saki-model-option-name">{model.label || model.id}</span>
                    <span className="saki-model-option-meta">
                      <span
                        className={`saki-model-multiplier ${multiplier === 0 ? "free" : multiplier !== 1 ? "custom" : ""}`}
                        title={isEn ? "Points cost multiplier" : isTw ? "積分消耗乘區" : "积分消耗乘区"}
                      >
                        {multiplierText}
                      </span>
                      {supportsVision ? (
                        <span className="saki-model-vision-icon" title="支持视觉" aria-label="支持视觉">
                          <ScanEye size={14} />
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
});
