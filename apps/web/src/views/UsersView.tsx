import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Coins,
  Database,
  Edit3,
  Infinity as InfinityIcon,
  KeyRound,
  Layers,
  Loader2,
  LogIn,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UserCog,
  UserPlus,
  UserRound,
  X
} from "lucide-react";
import type {
  CurrentUser,
  CreateUserRequest,
  DatabaseVisualizerInstance,
  InstanceAssignee,
  ManagedInstance,
  ManagedRole,
  ManagedUser,
  PermissionCode,
  UpdateUserRequest
} from "@webops/shared";
import { api, ApiError } from "../api.js";
import { usePanelT } from "../i18n/index.js";
import { AccountAvatar, avatarFileToDataUrl } from "../components/common/AccountAvatar.js";
import {
  InstanceStatusIcon,
  PageErrorToast,
  instanceAssigneeLabel,
  instanceAssignedUsers,
  instanceTypeLabel,
  isInstanceAssignedTo,
  managedUserAssignee,
  ownerRoleLabel,
  primaryAssigneeFields
} from "../components/common/CommonUI.js";
import { formatDate } from "../utils/path.js";
import {
  PERMISSION_GROUPS,
  PERM_GROUP_ICONS,
  elevatedRoleNamesForUi,
  isElevatedManagedRole,
  isNoRolePermissionRole,
  roleDisplayName,
  roleNameDisplayName,
  roleNamesDisplay
} from "../utils/role.js";
import { AdminUserPointsModal } from "../AdminUserPointsModal.js";

export function UsersView({
  token,
  currentUser,
  onLogout,
  onSwitchUser,
  refreshTick
}: {
  token: string;
  currentUser: CurrentUser;
  onLogout: () => void;
  onSwitchUser: (token: string, user: CurrentUser) => void;
  refreshTick: number;
}) {
  const t = usePanelT();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<InstanceAssignee[]>([]);
  const [instances, setInstances] = useState<ManagedInstance[]>([]);
  const [databases, setDatabases] = useState<DatabaseVisualizerInstance[]>([]);
  const [assignmentTargetUser, setAssignmentTargetUser] = useState<InstanceAssignee | null>(null);
  const [assignmentDraftIds, setAssignmentDraftIds] = useState<string[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [rolePermissions, setRolePermissions] = useState<PermissionCode[]>([]);
  const [error, setError] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserRequest>({});
  const editAvatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [switchingUserId, setSwitchingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [pointsTargetUser, setPointsTargetUser] = useState<ManagedUser | null>(null);
  const [pointsModalOpen, setPointsModalOpen] = useState(false);
  const canViewAccounts = currentUser.permissions.includes("user.view");
  const canUpdateAccounts = currentUser.permissions.includes("user.update");
  const canCreateUsers = currentUser.permissions.includes("user.create");
  const canDeleteUsers = currentUser.permissions.includes("user.delete");
  const canManageRoles = currentUser.isSuperAdmin && currentUser.permissions.includes("role.view") && currentUser.permissions.includes("role.update");
  const canManageAccounts = currentUser.isAdmin && canViewAccounts && canUpdateAccounts;
  const canAssignInstances = currentUser.isAdmin && currentUser.permissions.includes("instance.update");
  const assignableRoles = useMemo(
    () =>
      roles.filter((role) => {
        if (isNoRolePermissionRole(role)) return false;
        return currentUser.isSuperAdmin || !isElevatedManagedRole(role);
      }),
    [currentUser.isSuperAdmin, roles]
  );
  const [form, setForm] = useState<CreateUserRequest>({
    username: "",
    password: "",
    displayName: "",
    roleIds: [],
    status: "ACTIVE"
  });

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [nextUsers, nextRoles, nextAssignees, nextInstances, nextDatabases] = await Promise.all([
        canManageAccounts ? api.users(token) : Promise.resolve([]),
        currentUser.permissions.includes("role.view") ? api.roles(token) : Promise.resolve([]),
        canAssignInstances ? api.instanceAssignees(token) : Promise.resolve([]),
        canAssignInstances ? api.instances(token) : Promise.resolve([]),
        canAssignInstances ? api.listDatabases(token).then((res) => res.databases) : Promise.resolve([])
      ]);
      setUsers(nextUsers);
      setRoles(nextRoles);
      setAssignableUsers(nextAssignees);
      setInstances(nextInstances);
      setDatabases(nextDatabases);
      setSelectedRoleId((current) => current || nextRoles[0]?.id || "");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : t("users.errorReadFailed"));
    }
  }, [canAssignInstances, canManageAccounts, currentUser.permissions, onLogout, t, token]);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const assignableUserIds = useMemo(() => new Set(assignableUsers.map((user) => user.id)), [assignableUsers]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  useEffect(() => {
    setRolePermissions(selectedRole?.permissions ?? []);
  }, [selectedRole]);

  const [permSearch, setPermSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [showMobileCreate, setShowMobileCreate] = useState(false);

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(query) ||
        (u.displayName && u.displayName.toLowerCase().includes(query)) ||
        u.roleNames.some((r) => roleNameDisplayName(r, t).toLowerCase().includes(query) || r.toLowerCase().includes(query))
    );
  }, [users, userSearch, t]);

  const allAvailablePermissions = useMemo(
    () => PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.code)),
    []
  );

  const isRolePermissionsDirty = useMemo(() => {
    if (!selectedRole) return false;
    const original = [...(selectedRole.permissions ?? [])].sort();
    const current = [...rolePermissions].sort();
    if (original.length !== current.length) return true;
    return original.some((val, idx) => val !== current[idx]);
  }, [selectedRole, rolePermissions]);

  const permissionsDiffCount = useMemo(() => {
    if (!selectedRole) return 0;
    const originalSet = new Set(selectedRole.permissions ?? []);
    const currentSet = new Set(rolePermissions);
    let diff = 0;
    for (const code of allAvailablePermissions) {
      if (originalSet.has(code) !== currentSet.has(code)) diff++;
    }
    return diff;
  }, [allAvailablePermissions, rolePermissions, selectedRole]);

  const grantAllPermissions = useCallback(() => {
    setRolePermissions([...allAvailablePermissions]);
  }, [allAvailablePermissions]);

  const revokeAllPermissions = useCallback(() => {
    setRolePermissions([]);
  }, []);

  const resetRolePermissions = useCallback(() => {
    if (!selectedRole) return;
    setRolePermissions(selectedRole.permissions ?? []);
  }, [selectedRole]);

  const toggleGroupPermissions = useCallback((groupCodes: PermissionCode[]) => {
    setRolePermissions((curr) => {
      const allSelected = groupCodes.every((code) => curr.includes(code));
      if (allSelected) {
        return curr.filter((c) => !groupCodes.includes(c));
      }
      return [...new Set([...curr, ...groupCodes])].sort();
    });
  }, []);

  const filteredGroups = useMemo(() => {
    const query = permSearch.trim().toLowerCase();
    if (!query) return PERMISSION_GROUPS;
    return PERMISSION_GROUPS.map((group) => {
      const groupName = t(group.groupKey).toLowerCase();
      const matchingItems = group.items.filter((item) => {
        const label = t(item.labelKey).toLowerCase();
        return label.includes(query) || item.code.toLowerCase().includes(query) || groupName.includes(query);
      });
      return {
        ...group,
        items: matchingItems
      };
    }).filter((group) => group.items.length > 0);
  }, [permSearch, t]);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingUser(true);
    setError("");
    try {
      const user = await api.createUser(token, form);
      setUsers((current) => [user, ...current]);
      setForm({ username: "", password: "", displayName: "", roleIds: [], status: "ACTIVE" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("users.errorCreateFailed"));
    } finally {
      setCreatingUser(false);
    }
  }

  function openUserEditor(user: ManagedUser) {
    setEditingUser(user);
    setEditForm({
      username: user.username,
      displayName: user.displayName,
      avatarDataUrl: user.avatarDataUrl ?? null,
      status: user.status,
      roleIds: user.roleIds
    });
  }

  function closeUserEditor() {
    setEditingUser(null);
    setEditForm({});
  }

  async function chooseEditedUserAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.item(0);
    event.target.value = "";
    if (!file) return;

    setError("");
    try {
      const avatarDataUrl = await avatarFileToDataUrl(file);
      setEditForm((current) => ({ ...current, avatarDataUrl }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("account.errorAvatarRead"));
    }
  }

  async function saveEditedUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) return;
    setSavingUser(true);
    setError("");
    try {
      const payload: UpdateUserRequest = {
        username: editForm.username ?? editingUser.username,
        displayName: editForm.displayName ?? editingUser.displayName,
        status: editForm.status ?? editingUser.status,
        roleIds: editForm.roleIds ?? editingUser.roleIds
      };
      const nextAvatarDataUrl = editForm.avatarDataUrl ?? null;
      if (nextAvatarDataUrl !== (editingUser.avatarDataUrl ?? null)) {
        payload.avatarDataUrl = nextAvatarDataUrl;
      }
      if (editForm.password?.trim()) {
        payload.password = editForm.password;
      }
      const updated = await api.updateUser(token, editingUser.id, payload);
      setUsers((current) => current.map((item) => (item.id === editingUser.id ? updated : item)));
      closeUserEditor();
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("users.errorSaveFailed"));
    } finally {
      setSavingUser(false);
    }
  }

  async function switchToUser(user: ManagedUser) {
    setSwitchingUserId(user.id);
    setError("");
    try {
      const result = await api.switchUser(token, user.id);
      onSwitchUser(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("users.errorSwitchFailed"));
      setSwitchingUserId(null);
    }
  }

  async function deleteUser(user: ManagedUser) {
    if (user.id === currentUser.id) {
      setError(t("users.errorDeleteSelf"));
      return;
    }
    const label = user.displayName && user.displayName !== user.username ? `@${user.username}（${user.displayName}）` : `@${user.username}`;
    if (!window.confirm(`确定删除用户 ${label} 吗？此操作无法撤销。`)) return;

    setDeletingUserId(user.id);
    setError("");
    try {
      await api.deleteUser(token, user.id);
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setAssignableUsers((current) => current.filter((item) => item.id !== user.id));
      setInstances((current) =>
        current.map((instance) => ({
          ...instance,
          ...(instance.createdByUserId === user.id
            ? {
                createdByUserId: null,
                createdByUsername: null,
                createdByDisplayName: null,
                createdByRole: null
              }
            : {}),
          ...(() => {
            const assignees = instanceAssignedUsers(instance).filter((assignee) => assignee.userId !== user.id);
            return {
              assignees,
              ...primaryAssigneeFields(assignees)
            };
          })()
        }))
      );
      if (editingUser?.id === user.id) closeUserEditor();
      void refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : t("users.errorDeleteFailed"));
    } finally {
      setDeletingUserId(null);
    }
  }

  async function saveRolePermissions() {
    if (!selectedRole) return;
    setSavingRole(true);
    setError("");
    try {
      const updated = await api.updateRolePermissions(token, selectedRole.id, { permissions: rolePermissions });
      setRoles((current) => current.map((role) => (role.id === updated.id ? updated : role)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("users.errorRoleSaveFailed"));
    } finally {
      setSavingRole(false);
    }
  }

  function togglePermission(permission: PermissionCode) {
    setRolePermissions((current) =>
      current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission].sort()
    );
  }

  function openAssignmentModal(user: InstanceAssignee) {
    setAssignmentTargetUser(user);
    const assignedInstIds = instances.filter((instance) => isInstanceAssignedTo(instance, user.id)).map((instance) => instance.id);
    const assignedDbIds = databases.filter((db) => isInstanceAssignedTo(db, user.id)).map((db) => db.id);
    setAssignmentDraftIds([...assignedInstIds, ...assignedDbIds]);
  }

  function toggleAssignmentDraft(instanceId: string, checked: boolean) {
    setAssignmentDraftIds((current) =>
      checked ? [...new Set([...current, instanceId])] : current.filter((id) => id !== instanceId)
    );
  }

  async function saveUserAssignments(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignmentTargetUser) return;
    setSavingAssignment(true);
    setError("");
    try {
      const draftIds = new Set(assignmentDraftIds);
      const updates = instances.filter((instance) => {
        const currentlyAssignedToTarget = isInstanceAssignedTo(instance, assignmentTargetUser.id);
        const shouldAssignToTarget = draftIds.has(instance.id);
        return currentlyAssignedToTarget !== shouldAssignToTarget;
      });
      const updatedInstances = await Promise.all(
        updates.map((instance) => {
          const currentAssigneeIds = instanceAssignedUsers(instance).map((user) => user.userId);
          const assignedToUserIds = draftIds.has(instance.id)
            ? [...new Set([...currentAssigneeIds, assignmentTargetUser.id])]
            : currentAssigneeIds.filter((userId) => userId !== assignmentTargetUser.id);
          return api.updateInstance(token, instance.id, { assignedToUserIds });
        })
      );
      const updatedById = new Map(updatedInstances.map((instance) => [instance.id, instance]));
      setInstances((current) => current.map((instance) => updatedById.get(instance.id) ?? instance));

      const dbUpdates = databases.filter((db) => {
        const currentlyAssignedToTarget = isInstanceAssignedTo(db, assignmentTargetUser.id);
        const shouldAssignToTarget = draftIds.has(db.id);
        return currentlyAssignedToTarget !== shouldAssignToTarget;
      });
      const updatedDbs = await Promise.all(
        dbUpdates.map((db) => {
          const currentAssigneeIds = instanceAssignedUsers(db).map((user) => user.userId);
          const assignedToUserIds = draftIds.has(db.id)
            ? [...new Set([...currentAssigneeIds, assignmentTargetUser.id])]
            : currentAssigneeIds.filter((userId) => userId !== assignmentTargetUser.id);
          return api.updateDatabase(token, db.id, { assignedToUserIds });
        })
      );
      const updatedDbById = new Map(updatedDbs.map((res) => [res.database.id, res.database]));
      setDatabases((current) => current.map((db) => updatedDbById.get(db.id) ?? db));

      setAssignmentTargetUser(null);
      setAssignmentDraftIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("users.errorAssignFailed"));
    } finally {
      setSavingAssignment(false);
    }
  }

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />
      {assignmentTargetUser ? (
        <div className="modal-backdrop">
          <div className="modal-panel assignment-modal assignment-picker-modal" role="dialog" aria-modal="true" aria-labelledby="assignment-modal-title">
            <div className="section-heading modal-heading">
              <div className="role-heading-info">
                <h2 id="assignment-modal-title">{t("users.assignment.title")}</h2>
                <p>{t("users.assignment.copy")}</p>
              </div>
              <button
                className="icon-button mini"
                disabled={savingAssignment}
                title={t("common.close")}
                type="button"
                onClick={() => {
                  setAssignmentTargetUser(null);
                  setAssignmentDraftIds([]);
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="assignment-target-card">
              <UserRound size={20} />
              <div>
                <strong>{assignmentTargetUser.displayName || assignmentTargetUser.username}</strong>
                <span>
                  @{assignmentTargetUser.username} · {ownerRoleLabel(assignmentTargetUser.role, t)}
                </span>
              </div>
            </div>
            <form className="assignment-form assignment-picker-form" onSubmit={saveUserAssignments}>
              <div className="assignment-instance-summary">
                <div>
                  <strong>{assignmentDraftIds.length} {t("users.assignment.selected")}</strong>
                  <span>{instances.length + databases.length} {t("users.assignment.available")}</span>
                </div>
              </div>
              <div className="assignment-instance-grid assignment-picker-grid">
                {instances.map((instance) => {
                  const checked = assignmentDraftIds.includes(instance.id);
                  return (
                    <label className={`assignment-instance-row ${checked ? "active" : ""}`} key={instance.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={savingAssignment}
                        onChange={(event) => toggleAssignmentDraft(instance.id, event.target.checked)}
                      />
                      <span className="assignment-instance-icon">
                        <InstanceStatusIcon status={instance.status} size={16} />
                      </span>
                      <span className="assignment-instance-copy">
                        <strong>{instance.name}</strong>
                        <small>
                          {instanceTypeLabel(instance.type)} · {instance.nodeName ?? instance.nodeId}
                        </small>
                      </span>
                      <span className="assignment-instance-owner">{instanceAssigneeLabel(instance)}</span>
                    </label>
                  );
                })}
                {databases.map((db) => {
                  const checked = assignmentDraftIds.includes(db.id);
                  return (
                    <label className={`assignment-instance-row db-assignment-row ${checked ? "active" : ""}`} key={`db-${db.id}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={savingAssignment}
                        onChange={(event) => toggleAssignmentDraft(db.id, event.target.checked)}
                      />
                      <span className="assignment-instance-icon db-icon">
                        <Database size={16} />
                      </span>
                      <span className="assignment-instance-copy">
                        <strong>{db.name}</strong>
                        <small>
                          {db.engine.toUpperCase()} 数据库可视化 · {db.nodeName ?? db.nodeId}
                        </small>
                      </span>
                      <span className="assignment-instance-owner">{instanceAssigneeLabel(db)}</span>
                    </label>
                  );
                })}
                {instances.length === 0 && databases.length === 0 ? <div className="empty-state">{t("users.assignment.empty")}</div> : null}
              </div>
              <div className="assignment-actions">
                <button
                  className="secondary-button"
                  disabled={savingAssignment}
                  type="button"
                  onClick={() => {
                    setAssignmentTargetUser(null);
                    setAssignmentDraftIds([]);
                  }}
                >
                  {t("common.cancel")}
                </button>
                <button className="primary-button" disabled={savingAssignment} type="submit">
                  <UserCheck size={17} />
                  {savingAssignment ? t("common.saving") : t("users.assignment.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingUser ? (
        <div className="modal-backdrop">
          <div className="modal-panel user-edit-modal" role="dialog" aria-modal="true" aria-labelledby="user-edit-title">
            <div className="section-heading modal-heading">
              <div className="role-heading-info">
                <h2 id="user-edit-title">{t("users.edit.title")}</h2>
                <p>{editingUser.username}{t("users.edit.copySuffix")}</p>
              </div>
              <button className="icon-button mini" disabled={savingUser} title={t("common.close")} type="button" onClick={closeUserEditor}>
                <X size={18} />
              </button>
            </div>
            <form className="modal-form user-edit-form" onSubmit={saveEditedUser}>
              <input
                ref={editAvatarFileInputRef}
                className="hidden-file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => void chooseEditedUserAvatar(event)}
              />
              <div className="managed-user-avatar-editor">
                <button
                  className="managed-user-avatar-button"
                  disabled={savingUser}
                  title={t("account.uploadAvatar")}
                  type="button"
                  onClick={() => editAvatarFileInputRef.current?.click()}
                >
                  <AccountAvatar
                    avatarDataUrl={editForm.avatarDataUrl ?? null}
                    displayName={editForm.displayName ?? editingUser.displayName}
                    username={editForm.username ?? editingUser.username}
                    className="managed-user-preview"
                  />
                  <span className="account-avatar-action">
                    <Camera size={15} />
                  </span>
                </button>
                <div className="managed-user-avatar-copy">
                  <strong>{(editForm.displayName ?? editingUser.displayName).trim() || editingUser.username}</strong>
                  <span>@{editForm.username ?? editingUser.username}</span>
                  <div className="account-upload-actions">
                    <button className="icon-button mini" disabled={savingUser} type="button" title={t("account.uploadAvatar")} aria-label={t("account.uploadAvatar")} onClick={() => editAvatarFileInputRef.current?.click()}>
                      <Upload size={15} />
                    </button>
                    <button
                      className="icon-button mini danger-action"
                      disabled={savingUser}
                      type="button"
                      title={t("common.remove")}
                      aria-label={t("common.remove")}
                      onClick={() => setEditForm((current) => ({ ...current, avatarDataUrl: null }))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="user-edit-grid">
                <label>
                  {t("users.username")}
                  <input
                    value={editForm.username ?? ""}
                    onChange={(event) => setEditForm((current) => ({ ...current, username: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  {t("users.displayName")}
                  <input
                    value={editForm.displayName ?? ""}
                    onChange={(event) => setEditForm((current) => ({ ...current, displayName: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  {t("users.status")}
                  <select
                    value={editForm.status ?? "ACTIVE"}
                    onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value as ManagedUser["status"] }))}
                  >
                    <option value="ACTIVE">{t("users.status.active")}</option>
                    <option value="DISABLED">{t("users.status.disabled")}</option>
                  </select>
                </label>
                <label>
                  {t("users.newPassword")}
                  <input
                    type="password"
                    value={editForm.password ?? ""}
                    onChange={(event) => setEditForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder={t("users.newPassword.placeholder")}
                  />
                </label>
              </div>
              <div className="user-role-editor">
                <span className="user-role-editor-title">{t("users.roles")}</span>
                <div className="permission-group-items user-role-options">
                  <label className={`permission-chip ${(editForm.roleIds ?? []).length === 0 ? "active" : ""}`}>
                    <input
                      className="hidden-checkbox"
                      type="checkbox"
                      checked={(editForm.roleIds ?? []).length === 0}
                      onChange={() => setEditForm((current) => ({ ...current, roleIds: [] }))}
                    />
                    <div className="permission-chip-content">
                      {(editForm.roleIds ?? []).length === 0 ? <ShieldCheck size={17} /> : <div className="permission-chip-dot" />}
                      <span className="permission-label">{t("users.noRole")}</span>
                    </div>
                  </label>
                  {assignableRoles.map((role) => {
                    const isActive = (editForm.roleIds ?? []).includes(role.id);
                    return (
                      <label className={`permission-chip ${isActive ? "active" : ""}`} key={role.id}>
                        <input
                          className="hidden-checkbox"
                          type="checkbox"
                          checked={isActive}
                          onChange={(event) =>
                            setEditForm((current) => {
                              const currentRoleIds = current.roleIds ?? [];
                              return {
                                ...current,
                                roleIds: event.target.checked
                                  ? [...new Set([...currentRoleIds, role.id])]
                                  : currentRoleIds.filter((id) => id !== role.id)
                              };
                            })
                          }
                        />
                        <div className="permission-chip-content">
                          {isActive ? <ShieldCheck size={17} /> : <div className="permission-chip-dot" />}
                          <span className="permission-label">{roleDisplayName(role, t)}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="assignment-actions">
                <button className="secondary-button" disabled={savingUser} type="button" onClick={closeUserEditor}>
                  {t("common.cancel")}
                </button>
                <button className="primary-button" disabled={savingUser} type="submit">
                  <Save size={18} />
                  {savingUser ? t("common.saving") : t("users.saveUser")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {!canManageAccounts && canAssignInstances ? (
        <section className="panel-block users-panel">
          <div className="section-heading">
            <h2>{t("users.title")}</h2>
            <span>{assignableUsers.length} {t("users.assignableCount")}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("users.username")}</th>
                  <th>{t("users.displayName")}</th>
                  <th>{t("users.role")}</th>
                  <th>{t("users.assignedInstances")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {assignableUsers.map((assignee) => {
                  const assignedCount = instances.filter((instance) => isInstanceAssignedTo(instance, assignee.id)).length;
                  return (
                    <tr key={assignee.id}>
                      <td>{assignee.username}</td>
                      <td>{assignee.displayName || "-"}</td>
                      <td>{ownerRoleLabel(assignee.role, t)}</td>
                      <td>{assignedCount}</td>
                      <td>
                        <div className="user-row-actions">
                          <button
                            className="icon-button mini"
                            type="button"
                            title={t("users.assignment.button")}
                            aria-label={t("users.assignment.button")}
                            onClick={() => openAssignmentModal(assignee)}
                          >
                            <ShieldCheck size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {assignableUsers.length === 0 ? <div className="empty-state">{t("users.assignment.emptyUsers")}</div> : null}
          </div>
        </section>
      ) : null}

      {canManageAccounts ? (
        <>
          <section className={`user-layout ${canCreateUsers ? "" : "single-column"}`}>
            {canCreateUsers ? (
              <div className={`panel-block user-form-panel ${showMobileCreate ? "mobile-open" : ""}`}>
                <div className="section-heading">
                  <h2>{t("users.create.title")}</h2>
                </div>
                <form className="task-form" onSubmit={createUser}>
                  <label>
                    {t("users.username")}
                    <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} required />
                  </label>
                  <label>
                    {t("users.displayName")}
                    <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required />
                  </label>
                  <label>
                    {t("auth.password")}
                    <input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required />
                  </label>
                  <label>
                    {t("users.role")}
                    <select
                      value={form.roleIds?.[0] ?? ""}
                      onChange={(event) => setForm((current) => ({ ...current, roleIds: event.target.value ? [event.target.value] : [] }))}
                    >
                      <option value="">{t("users.noRole")}</option>
                      {assignableRoles.map((role) => (
                        <option value={role.id} key={role.id}>
                          {roleDisplayName(role, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-button form-submit" disabled={creatingUser} type="submit">
                    <UserCog size={18} />
                    {creatingUser ? t("users.create.creating") : t("users.create.submit")}
                  </button>
                </form>
              </div>
            ) : null}

            <div className="panel-block users-panel">
              <div className="section-heading users-panel-header">
                <div className="users-title-line">
                  <h2>{t("users.title")}</h2>
                  <span className="users-count-tag">{filteredUsers.length} {t("users.countUnit")}</span>
                </div>

                <div className="users-header-controls">
                  <div className="users-search-bar">
                    <Search size={14} className="users-search-icon" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="搜索用户名 / 昵称 / 角色..."
                    />
                    {userSearch ? (
                      <button type="button" className="users-search-clear" onClick={() => setUserSearch("")}>
                        <X size={13} />
                      </button>
                    ) : null}
                  </div>

                  {canCreateUsers ? (
                    <button
                      type="button"
                      className={`mobile-create-toggle-btn ${showMobileCreate ? "active" : ""}`}
                      onClick={() => setShowMobileCreate((v) => !v)}
                    >
                      <UserPlus size={15} />
                      <span>{showMobileCreate ? "收起" : "添加用户"}</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {/* 桌面端多列数据表格 */}
              <div className="table-wrap desktop-users-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t("users.username")}</th>
                      <th>{t("users.displayName")}</th>
                      <th>{t("users.role")}</th>
                      <th>积分</th>
                      <th>{t("users.status")}</th>
                      <th>{t("users.lastLogin")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => {
                      const assignee = managedUserAssignee(user);
                      const canOpenAssignment =
                        canAssignInstances && user.status === "ACTIVE" && assignee !== null && assignableUserIds.has(user.id);
                      const canSwitchAccount =
                        currentUser.isSuperAdmin &&
                        user.id !== currentUser.id &&
                        user.status === "ACTIVE" &&
                        !user.roleNames.includes("super_admin");
                      const canDeleteAccount = canDeleteUsers && user.id !== currentUser.id;
                      return (
                        <tr key={user.id}>
                          <td>
                            <div className="managed-user-identity">
                              <AccountAvatar
                                avatarDataUrl={user.avatarDataUrl}
                                displayName={user.displayName}
                                username={user.username}
                                className="compact"
                              />
                              <span>{user.username}</span>
                            </div>
                          </td>
                          <td>{user.displayName}</td>
                          <td>{roleNamesDisplay(user.roleNames, t)}</td>
                          <td>
                            {user.unlimitedPoints ? (
                              <span className="user-points-badge unlimited">
                                <InfinityIcon size={12} /> 无限
                              </span>
                            ) : (
                              <span className="user-points-badge">
                                {user.points ?? 0}
                              </span>
                            )}
                          </td>
                          <td>{user.status === "ACTIVE" ? t("users.status.active") : t("users.status.disabled")}</td>
                          <td>{formatDate(user.lastLoginAt)}</td>
                          <td>
                            <div className="user-row-actions">
                              {currentUser.isAdmin ? (
                                <button
                                  className="icon-button mini"
                                  type="button"
                                  title="管理用户积分与消耗明细"
                                  aria-label="管理用户积分与消耗明细"
                                  onClick={() => {
                                    setPointsTargetUser(user);
                                    setPointsModalOpen(true);
                                  }}
                                >
                                  <Coins size={14} />
                                </button>
                              ) : null}
                              <button
                                className="icon-button mini"
                                type="button"
                                title={t("users.edit.button")}
                                aria-label={t("users.edit.button")}
                                onClick={() => openUserEditor(user)}
                              >
                                <UserCog size={14} />
                              </button>
                              {canOpenAssignment && assignee ? (
                                <button
                                  className="icon-button mini"
                                  type="button"
                                  title={t("users.assignment.button")}
                                  aria-label={t("users.assignment.button")}
                                  onClick={() => openAssignmentModal(assignee)}
                                >
                                  <ShieldCheck size={14} />
                                </button>
                              ) : null}
                              {canSwitchAccount ? (
                                <button
                                  className="icon-button mini"
                                  disabled={switchingUserId === user.id}
                                  type="button"
                                  title={switchingUserId === user.id ? t("users.switching") : t("users.switch.button")}
                                  aria-label={t("users.switch.button")}
                                  onClick={() => void switchToUser(user)}
                                >
                                  <LogIn size={14} />
                                </button>
                              ) : null}
                              {canDeleteAccount ? (
                                <button
                                  className="icon-button mini danger-action"
                                  disabled={deletingUserId !== null}
                                  type="button"
                                  title={deletingUserId === user.id ? t("users.deleting") : t("users.delete.button")}
                                  aria-label={t("users.delete.button")}
                                  onClick={() => void deleteUser(user)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredUsers.length === 0 ? <div className="empty-state">未找到匹配的用户</div> : null}
              </div>

              {/* 移动端流式卡片列表 */}
              <div className="mobile-user-cards-wrap">
                {filteredUsers.length === 0 ? (
                  <div className="empty-state">未找到匹配的用户</div>
                ) : (
                  filteredUsers.map((user) => {
                    const assignee = managedUserAssignee(user);
                    const canOpenAssignment =
                      canAssignInstances && user.status === "ACTIVE" && assignee !== null && assignableUserIds.has(user.id);
                    const canSwitchAccount =
                      currentUser.isSuperAdmin &&
                      user.id !== currentUser.id &&
                      user.status === "ACTIVE" &&
                      !user.roleNames.includes("super_admin");
                    const canDeleteAccount = canDeleteUsers && user.id !== currentUser.id;

                    return (
                      <div className="mobile-user-card" key={user.id}>
                        {/* 头部：头像 + 昵称/用户名 + 状态 */}
                        <div className="mobile-user-card-header">
                          <AccountAvatar
                            avatarDataUrl={user.avatarDataUrl}
                            displayName={user.displayName}
                            username={user.username}
                            className="mobile-avatar"
                          />
                          <div className="mobile-user-info">
                            <div className="mobile-user-name-line">
                              <strong className="mobile-user-displayname">
                                {user.displayName || user.username}
                              </strong>
                              <span className={`status-pill mini ${user.status === "ACTIVE" ? "online" : "offline"}`}>
                                {user.status === "ACTIVE" ? t("users.status.active") : t("users.status.disabled")}
                              </span>
                            </div>
                            <span className="mobile-user-handle">@{user.username}</span>
                          </div>
                        </div>

                        {/* 属性行：角色标签 + 积分 + 登录时间 */}
                        <div className="mobile-user-meta-row">
                          <span className="mobile-role-tag">{roleNamesDisplay(user.roleNames, t)}</span>
                          {user.unlimitedPoints ? (
                            <span className="user-points-badge unlimited">
                              <InfinityIcon size={12} /> 无限积分
                            </span>
                          ) : (
                            <span className="user-points-badge">
                              <Coins size={12} /> {user.points ?? 0} 积分
                            </span>
                          )}
                          <span className="mobile-last-login">
                            <Clock size={11} /> {formatDate(user.lastLoginAt)}
                          </span>
                        </div>

                        {/* 底部触控大按钮栏 */}
                        <div className="mobile-user-actions">
                          {currentUser.isAdmin ? (
                            <button
                              type="button"
                              className="mobile-action-pill points-action"
                              onClick={() => {
                                setPointsTargetUser(user);
                                setPointsModalOpen(true);
                              }}
                            >
                              <Coins size={14} />
                              <span>积分</span>
                            </button>
                          ) : null}

                          <button
                            type="button"
                            className="mobile-action-pill edit-action"
                            onClick={() => openUserEditor(user)}
                          >
                            <UserCog size={14} />
                            <span>编辑</span>
                          </button>

                          {canOpenAssignment && assignee ? (
                            <button
                              type="button"
                              className="mobile-action-pill assign-action"
                              onClick={() => openAssignmentModal(assignee)}
                            >
                              <ShieldCheck size={14} />
                              <span>分配</span>
                            </button>
                          ) : null}

                          {canSwitchAccount ? (
                            <button
                              type="button"
                              className="mobile-action-pill switch-action"
                              disabled={switchingUserId === user.id}
                              onClick={() => void switchToUser(user)}
                            >
                              <LogIn size={14} />
                              <span>切换</span>
                            </button>
                          ) : null}

                          {canDeleteAccount ? (
                            <button
                              type="button"
                              className="mobile-action-pill delete-action"
                              disabled={deletingUserId !== null}
                              onClick={() => void deleteUser(user)}
                            >
                              <Trash2 size={14} />
                              <span>删除</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {canManageRoles ? (
          <section className="panel-block role-workspace-panel">
            {/* 移动端横向角色切换条 */}
            <div className="mobile-role-slider">
              {roles.map((role) => {
                const isSelected = role.id === selectedRoleId;
                const count = (isSelected ? rolePermissions : role.permissions).length;
                return (
                  <button
                    key={role.id}
                    type="button"
                    className={`mobile-role-slide-btn ${isSelected ? "active" : ""}`}
                    onClick={() => setSelectedRoleId(role.id)}
                  >
                    <span>{roleDisplayName(role, t)}</span>
                    <span className="slide-badge">{count}</span>
                    {isSelected && isRolePermissionsDirty ? <span className="role-unsaved-dot" /> : null}
                  </button>
                );
              })}
            </div>

            <div className="role-workspace-layout">
              {/* Left Role Master Sidebar */}
              <aside className="role-master-sidebar">
                <div className="role-sidebar-header">
                  <h3>系统角色</h3>
                  <span className="role-count-tag">{roles.length}</span>
                </div>
                <div className="role-list-scroller">
                  {roles.map((role) => {
                    const isSelected = role.id === selectedRoleId;
                    const count = (isSelected ? rolePermissions : role.permissions).length;
                    return (
                      <button
                        key={role.id}
                        type="button"
                        className={`role-list-item ${isSelected ? "active" : ""}`}
                        onClick={() => setSelectedRoleId(role.id)}
                      >
                        <div className="role-item-main">
                          <div className="role-item-title-row">
                            <span className="role-item-name">{roleDisplayName(role, t)}</span>
                            {isSelected && isRolePermissionsDirty ? (
                              <span className="role-unsaved-dot" title="有未保存修改" />
                            ) : null}
                          </div>
                          <span className="role-item-subtitle">{role.id}</span>
                        </div>
                        <div className="role-item-stats">
                          <span className="role-item-badge">{count}/{allAvailablePermissions.length}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>

              {/* Right Detail Workspace */}
              <main className="role-detail-workspace">
                <div className="role-detail-header">
                  <div className="role-detail-heading">
                    <div className="role-detail-title-line">
                      <h2>{selectedRole ? roleDisplayName(selectedRole, t) : t("roles.permissions.title")}</h2>
                      {isRolePermissionsDirty ? (
                        <span className="role-dirty-pill">未保存更改 ({permissionsDiffCount})</span>
                      ) : (
                        <span className="role-clean-pill">已保存</span>
                      )}
                    </div>
                    <p className="role-detail-desc">{t("roles.permissions.copy")}</p>
                  </div>

                  <div className="role-detail-actions">
                    <div className="role-search-box">
                      <Search size={13} />
                      <input
                        type="text"
                        value={permSearch}
                        onChange={(e) => setPermSearch(e.target.value)}
                        placeholder="快速过滤权限..."
                      />
                      {permSearch ? (
                        <button type="button" className="role-search-clear" onClick={() => setPermSearch("")}>
                          <X size={12} />
                        </button>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      className="role-action-btn"
                      onClick={grantAllPermissions}
                      title="授予当前角色全部权限"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      className="role-action-btn"
                      onClick={revokeAllPermissions}
                      title="清空当前角色权限"
                    >
                      清空
                    </button>
                    {isRolePermissionsDirty ? (
                      <button
                        type="button"
                        className="role-action-btn"
                        onClick={resetRolePermissions}
                        title="重置为上次保存的权限"
                      >
                        重置
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="primary-button role-save-action"
                      disabled={!selectedRole || savingRole}
                      onClick={() => void saveRolePermissions()}
                    >
                      {savingRole ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                      <span>{savingRole ? t("common.saving") : t("roles.permissions.save")}</span>
                    </button>
                  </div>
                </div>

                {/* Permission Groups Grid */}
                <div className="role-perm-grid">
                  {filteredGroups.length === 0 ? (
                    <div className="role-perm-empty">
                      <p>未找到匹配“{permSearch}”的权限项</p>
                    </div>
                  ) : (
                    filteredGroups.map((group) => {
                      const groupCodes = group.items.map((i) => i.code);
                      const activeCount = groupCodes.filter((code) => rolePermissions.includes(code)).length;
                      const isAllSelected = groupCodes.length > 0 && activeCount === groupCodes.length;

                      return (
                        <div className="role-group-section" key={group.groupKey}>
                          <div className="role-group-header">
                            <div className="role-group-title">
                              <span className="role-group-icon">
                                {PERM_GROUP_ICONS[group.groupKey] ?? <Layers size={13} />}
                              </span>
                              <h4>{t(group.groupKey)}</h4>
                              <span className="role-group-badge">{activeCount}/{groupCodes.length}</span>
                            </div>
                            <button
                              type="button"
                              className="role-group-toggle-btn"
                              onClick={() => toggleGroupPermissions(groupCodes)}
                            >
                              {isAllSelected ? "清空此组" : "全选此组"}
                            </button>
                          </div>

                          <div className="role-group-grid">
                            {group.items.map((item) => {
                              const isActive = rolePermissions.includes(item.code);
                              return (
                                <label
                                  key={item.code}
                                  className={`role-perm-row ${isActive ? "selected" : ""}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isActive}
                                    onChange={() => togglePermission(item.code)}
                                  />
                                  <div className="role-perm-info">
                                    <span className="role-perm-label">{t(item.labelKey)}</span>
                                    <span className="role-perm-code">{item.code}</span>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </main>
            </div>
          </section>
          ) : null}
        </>
      ) : null}
      <AdminUserPointsModal
        token={token}
        user={pointsTargetUser}
        open={pointsModalOpen}
        onClose={() => {
          setPointsModalOpen(false);
          setPointsTargetUser(null);
        }}
        onUpdated={(updated) => {
          setUsers((prev) =>
            prev.map((u) =>
              u.id === updated.id
                ? { ...u, points: updated.points, unlimitedPoints: updated.unlimitedPoints }
                : u
            )
          );
        }}
      />
    </>
  );
}

