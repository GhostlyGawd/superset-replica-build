import type { WorkspaceStatus } from "@swarm/db";
import type { SessionId, WorkspaceId } from "@swarm/shared";

/**
 * @swarm/core-engine — platform-agnostic orchestration: the domain event union,
 * reducer signatures, and status derivation that clients and host fold
 * identically (CQRS, spec §1). No Node-native dependencies.
 */

export const CORE_ENGINE_VERSION = "0.1.0";

/** Append-only domain events; materialized state is the fold of these. */
export type DomainEvent =
  | { readonly type: "workspace.created"; readonly workspaceId: WorkspaceId; readonly name: string }
  | {
      readonly type: "workspace.status_changed";
      readonly workspaceId: WorkspaceId;
      readonly status: WorkspaceStatus;
    }
  | {
      readonly type: "session.started";
      readonly sessionId: SessionId;
      readonly workspaceId: WorkspaceId;
    }
  | { readonly type: "session.exited"; readonly sessionId: SessionId; readonly exitCode: number }
  | {
      /**
       * A workspace lifecycle (`.swarm`/`.grove` config) command running: `setup`
       * before the agent launches, `teardown` after its session ends (P07). Output
       * is streamed as a bounded tail rather than per-keystroke, keeping the durable
       * log lean (the per-keystroke PTY stream stays out-of-band, architecture §4).
       */
      readonly type: "workspace.lifecycle";
      readonly workspaceId: WorkspaceId;
      readonly phase: "setup" | "teardown";
      readonly status: "running" | "done" | "error";
      /** The command line, present once it begins and on completion. */
      readonly command?: string;
      /** Process exit code, present on `done`/`error`. */
      readonly exitCode?: number;
      /** Bounded tail of the streamed output, present on `done`/`error`. */
      readonly output?: string;
    };

export type DomainEventType = DomainEvent["type"];

/** A client-side projection rebuilt purely by folding the event stream. */
export interface WorkspaceProjection {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly status: WorkspaceStatus;
}

/** Pure reducer: fold one event into prior state so every peer agrees. */
export type Reducer<S> = (state: S, event: DomainEvent) => S;

/** Derive a workspace's headline status from liveness signals. */
export function deriveStatus(
  hasRunningSession: boolean,
  hasUnreadChanges: boolean,
): WorkspaceStatus {
  if (hasRunningSession) {
    return "running";
  }
  if (hasUnreadChanges) {
    return "needs_attention";
  }
  return "idle";
}
