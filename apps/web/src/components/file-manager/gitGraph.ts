import type { InstanceGitCommit } from "@webops/shared";
export interface GitGraphRow {
  lane: number;
  incoming: boolean;
  edges: {
    from: number;
    to: number;
    fromNode: boolean;
  }[];
}

export function gitGraph(commits: InstanceGitCommit[]): {
  rows: GitGraphRow[];
  width: number;
} {
  let lanes: string[] = [];
  let width = 1;
  const rows = commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    const incoming = lane >= 0;
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(commit.hash);
    }
    const before = [...lanes];
    const next = lanes.filter((hash) => hash !== commit.hash);
    const missing = commit.parents.filter((hash) => !next.includes(hash));
    next.splice(Math.min(lane, next.length), 0, ...missing);
    const edges = before.flatMap((hash, from) =>
      hash === commit.hash
        ? []
        : [
            {
              from,
              to: next.indexOf(hash),
              fromNode: false,
            },
          ],
    );
    for (const parent of commit.parents)
      edges.push({
        from: lane,
        to: next.indexOf(parent),
        fromNode: true,
      });
    width = Math.max(width, before.length, next.length);
    lanes = next;
    return {
      lane,
      incoming,
      edges,
    };
  });
  return {
    rows,
    width: Math.min(width, 8) * 12 + 10,
  };
}
