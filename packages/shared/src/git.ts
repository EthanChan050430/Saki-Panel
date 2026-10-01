export interface InstanceGitChange {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
}

export interface InstanceGitStatus {
  available: boolean;
  initialized: boolean;
  branch: string;
  head: string | null;
  changes: InstanceGitChange[];
  ignored: string[];
  ignoreContent: string;
  authorName: string;
  authorEmail: string;
}

export interface InstanceGitCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  refs: string;
  subject: string;
  body: string;
}

export interface InstanceGitHistory {
  commits: InstanceGitCommit[];
  hasMore: boolean;
}

export interface InstanceGitDiff {
  diff: string;
  truncated: boolean;
}

export interface InstanceGitCommitRequest {
  paths: string[];
  message: string;
  authorName: string;
  authorEmail: string;
  expectedHead: string | null;
}

export interface InstanceGitIgnoreRequest {
  content: string;
  expectedContent: string;
  paths: string[];
}

export interface InstanceGitDraft {
  title: string;
  body: string;
  issue: string;
}
