import { SakiModelPicker } from "../SakiModelReasoningPanel.js";
import { DashboardPopover } from "../../dashboard/DashboardPopover.js";
import React from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  Check,
  CheckCircle2,
  Eye,
  ImageIcon,
  Paperclip,
  Shield,
  XOctagon
} from "lucide-react";
import { LiquidGlassContainer } from "../../common/LiquidGlass.js";
import {
  type SakiAgentPermissionMode,
  type SakiModelOption
} from "@webops/shared";
import type { SakiModelPointsMultiplierMap } from "../sakiChatHelpers.js";

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
  terminalSandbox?: boolean;
  onToggleTerminalSandbox?: (enabled: boolean) => void;

  // Model selector
  modelDropdownOpen: boolean;
  modelSelectorRef: React.RefObject<HTMLDivElement | null>;
  modelDropdownRef: React.RefObject<HTMLDivElement | null>;
  availableModels: SakiModelOption[];
  currentModelId: string;
  modelPointsMultipliers?: SakiModelPointsMultiplierMap;
  language: string;
  onSelectModel: (modelId: string) => void;
  onCloseModelDropdown: () => void;
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
  terminalSandbox,
  onToggleTerminalSandbox,
  modelDropdownOpen,
  modelSelectorRef,
  modelDropdownRef,
  availableModels,
  currentModelId,
  modelPointsMultipliers,
  language,
  onSelectModel,
  onCloseModelDropdown
}: SakiChatDropdownsProps) {
  return (
    <>
      {sakiAddMenuOpen && sakiAddBtnRef.current
        ? createPortal(
            <LiquidGlassContainer
              ref={sakiAddMenuRef}
              className="saki-add-menu-wrapper"
              style={{
                position: "fixed",
                left: sakiAddBtnRef.current.getBoundingClientRect().left,
                bottom: window.innerHeight - sakiAddBtnRef.current.getBoundingClientRect().top + 6
              }}
              cornerRadius={14}
              displacementScale={100}
              zoom={1.20}
              refractionIntensity={1.2}
              blurAmount={16}
              saturation={108}
              mode="shader"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="saki-add-menu">
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
              </div>
            </LiquidGlassContainer>,
            document.body
          )
        : null}

      {permissionDropdownOpen && permissionSelectorRef.current
        ? createPortal(
            <LiquidGlassContainer
              ref={permissionDropdownRef}
              className="saki-model-dropdown-wrapper saki-permission-dropdown-wrapper"
              style={{
                position: "fixed",
                left: Math.max(
                  8,
                  Math.min(
                    permissionSelectorRef.current.getBoundingClientRect().left,
                    window.innerWidth - Math.min(260, window.innerWidth - 16) - 10
                  )
                ),
                bottom: window.innerHeight - permissionSelectorRef.current.getBoundingClientRect().top + 8
              }}
              cornerRadius={12}
              displacementScale={100}
              zoom={1.20}
              refractionIntensity={1.2}
              blurAmount={16}
              saturation={108}
              mode="shader"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="saki-model-dropdown saki-permission-dropdown">
                <div className="saki-dropdown-title">智能体权限模式</div>
                {(
                  [
                    { id: "ask", label: "请求批准", desc: "终端联网、越界访问和风险操作询问", icon: Shield, colorClass: "ask" },
                    { id: "acceptEdits", label: "帮我批准", desc: "仅对检测到的风险操作请求批准", icon: CheckCircle2, colorClass: "accept" },
                    { id: "bypassPermissions", label: "完全访问权限", desc: "无需逐项批准，仍遵守账号与安全策略；外部文件仍需单次审批", icon: XOctagon, colorClass: "bypass" },
                    { id: "plan", label: "仅规划", desc: "只读探索和规划，不修改文件", icon: Eye, colorClass: "plan" }
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
                {onToggleTerminalSandbox ? (
                  <>
                    <div className="saki-perm-divider" />
                    <button
                      className="saki-perm-sandbox-row"
                      type="button"
                      onClick={() => onToggleTerminalSandbox(!terminalSandbox)}
                      title="限制终端与文件范围，禁止越界读取外部目录或其它项目"
                    >
                      <div className="saki-perm-sandbox-left">
                        <Shield size={14} className="saki-perm-sandbox-icon" />
                        <span className="saki-perm-sandbox-label">终端与工作区沙箱</span>
                      </div>
                      <div className={`saki-switch ${terminalSandbox ? "checked" : ""}`} aria-hidden="true">
                        <div className="saki-switch-handle" />
                      </div>
                    </button>
                  </>
                ) : null}
              </div>
            </LiquidGlassContainer>,
            document.body
          )
        : null}

      {modelDropdownOpen && modelSelectorRef.current
        ? <DashboardPopover anchorRef={modelSelectorRef} popoverRef={modelDropdownRef} onClose={onCloseModelDropdown}
              className="saki-model-dropdown-wrapper saki-reasoning-popover" width={320}>
              <SakiModelPicker models={availableModels} currentModelId={currentModelId} onSelectModel={onSelectModel} modelPointsMultipliers={modelPointsMultipliers} />
            </DashboardPopover>
        : null}
    </>
  );
});
