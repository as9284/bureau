/**
 * Pure commit-graph lane assignment for history visualization.
 * Deterministic lane allocation for linear and merge commits.
 */
export type GraphInputCommit = {
  oid: string;
  parentOids: string[];
};

export type GraphOutputCommit = GraphInputCommit & {
  lane: number;
  lanes: number[];
  connectors: Array<{ fromLane: number; toLane: number; parentOid: string }>;
};

export function assignGraphLanes(commits: GraphInputCommit[]): GraphOutputCommit[] {
  const laneEnds = new Map<number, string>();
  let maxLanes = 1;
  const results: GraphOutputCommit[] = [];

  for (const commit of commits) {
    let lane = findLaneForCommit(laneEnds, commit.oid);
    if (lane === undefined) {
      lane = firstFreeLane(laneEnds);
    }

    const connectors: GraphOutputCommit['connectors'] = [];

    for (const parentOid of commit.parentOids) {
      const existingLane = findLaneByOid(laneEnds, parentOid);
      const parentLane: number = existingLane ?? lane;
      if (parentLane !== undefined && parentLane !== lane) {
        connectors.push({ fromLane: lane, toLane: parentLane, parentOid });
      }
      laneEnds.set(parentLane ?? lane, parentOid);
    }

    laneEnds.set(lane, commit.oid);
    maxLanes = Math.max(maxLanes, laneEnds.size, lane + 1);

    results.push({
      ...commit,
      lane,
      lanes: range(maxLanes),
      connectors,
    });
  }

  return results;
}

function range(n: number): number[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => i);
}

function findLaneForCommit(laneEnds: Map<number, string>, oid: string): number | undefined {
  for (const [lane, endOid] of laneEnds) {
    if (endOid === oid) return lane;
  }
  return undefined;
}

function findLaneByOid(laneEnds: Map<number, string>, oid: string): number | undefined {
  for (const [lane, endOid] of laneEnds) {
    if (endOid === oid) return lane;
  }
  return undefined;
}

function firstFreeLane(laneEnds: Map<number, string>): number {
  let i = 0;
  while (laneEnds.has(i)) i += 1;
  return i;
}
