import type { PermissionCode } from "@webops/shared";
import { parseWorkspacePatch } from "./patch.js";

export const sakiToolPermissions: Record<string, PermissionCode> = {
  listinstances: "instance.view", describeinstance: "instance.view", instancelogs: "instance.logs",
  listfiles: "file.view", statfile: "file.view", findfiles: "file.view", findsymbols: "file.read",
  readfile: "file.read", searchfiles: "file.read", outlinefile: "file.read", readsymbol: "file.read",
  readmemory: "file.read", writememory: "file.write", gitstatus: "file.read", gitdiff: "file.read",
  writefile: "file.write", replaceinfile: "file.write", editlines: "file.write", applypatch: "file.write",
  batchedit: "file.write", mkdir: "file.write", renamepath: "file.write", deletepath: "file.delete",
  uploadbase64: "file.write", archivepaths: "file.write", extractarchive: "file.write",
  runcommand: "terminal.input", runinshell: "terminal.input", sendinput: "terminal.input", sendcommand: "terminal.input",
  sendshellinput: "terminal.input", createshell: "terminal.view", listshells: "terminal.view", closeshell: "terminal.input",
  diagnosecode: "terminal.input", getenvironmentinfo: "instance.view", updateinstancesettings: "instance.update",
  listtasks: "task.view", taskruns: "task.view", createscheduledtask: "task.create", updatescheduledtask: "task.update",
  deletescheduledtask: "task.delete", runtask: "task.run", searchaudit: "audit.view", requestexternalaccess: "file.read"
};

// Until there is OS process isolation, text filtering cannot confine these tools.
export const sakiHostExecutionTools = new Set(["runcommand", "runinshell", "sendinput", "sendcommand", "sendshellinput", "createshell", "diagnosecode", "getenvironmentinfo", "gitstatus", "gitdiff", "instanceaction", "runtask", "createscheduledtask", "updatescheduledtask"]);
const readsBeforeMutation = new Set(["replaceinfile", "editlines", "applypatch", "batchedit", "uploadbase64", "archivepaths", "extractarchive"]);

export function requiredSakiToolPermissions(name: string, args: Record<string, unknown> = {}): PermissionCode[] {
  const required = name === "instanceaction" ? [`instance.${String(args.action ?? "")}` as PermissionCode]
    : sakiToolPermissions[name] ? [sakiToolPermissions[name]!] : [];
  if (readsBeforeMutation.has(name) || (name === "writefile" && (args.overwrite === true || args.append === true))) required.push("file.read");
  // Saving an image overwrites a file and captures its previous contents for rollback.
  if (name === "generateimage" && typeof args.path === "string" && args.path.trim()) required.push("file.write", "file.read");
  if (name === "applypatch" && typeof args.patch === "string" && parseWorkspacePatch(args.patch).some((file) => file.kind === "delete")) required.push("file.delete");
  return [...new Set(required)];
}
