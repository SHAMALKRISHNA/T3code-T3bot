import {
  ProjectId,
  ProviderInstanceId,
  type ProviderInteractionMode,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildWorkLocallyStartTurnInput } from "./work-locally-start-turn";

const instanceId = ProviderInstanceId.make("codex");

function build(input: {
  readonly stored: ProviderInteractionMode;
  readonly planModeEnabled: boolean;
  readonly showInteractionModeToggle?: boolean;
}) {
  return buildWorkLocallyStartTurnInput({
    metadata: {
      commandId: "command",
      messageId: "message",
      threadId: "thread",
      createdAt: "2026-11-10T00:00:00.000Z",
    },
    thread: {
      projectId: ProjectId.make("project"),
      title: "Set up the worktree",
      modelSelection: { instanceId, model: "gpt-5.5" },
      runtimeMode: "approval-required",
      interactionMode: input.stored,
    },
    projectCwd: "/workspace",
    message: { text: "Do the work", attachments: [] },
    planModeEnabled: input.planModeEnabled,
    providers: [
      {
        instanceId,
        ...(input.showInteractionModeToggle === undefined
          ? {}
          : { showInteractionModeToggle: input.showInteractionModeToggle }),
      } as ServerProvider,
    ],
  });
}

describe("buildWorkLocallyStartTurnInput", () => {
  it("restarts a thread stored in plan mode in default while Plan mode is off on this device", () => {
    const input = build({ stored: "plan", planModeEnabled: false });
    expect(input.interactionMode).toBe("default");
    expect(input.bootstrap.createThread.interactionMode).toBe("default");
  });

  it("keeps plan mode when this device opted in", () => {
    const input = build({ stored: "plan", planModeEnabled: true });
    expect(input.interactionMode).toBe("plan");
    expect(input.bootstrap.createThread.interactionMode).toBe("plan");
  });

  it("runs in default for a provider without the mode control, even when opted in", () => {
    const input = build({
      stored: "plan",
      planModeEnabled: true,
      showInteractionModeToggle: false,
    });
    expect(input.interactionMode).toBe("default");
  });

  // The server launches this as a new thread with the payload's mode, so the source thread's
  // stored plan mode never applies and there is nothing to save on it first.
  it("launches a new thread that carries its own mode, instead of running the source thread", () => {
    const input = build({ stored: "plan", planModeEnabled: false });
    expect(input.threadId).toBe("thread");
    expect(input.bootstrap.createThread).toMatchObject({ interactionMode: "default" });
    expect(input).not.toHaveProperty("reuseExistingThread");
  });

  it("keeps the thread's model, approvals and server-held message", () => {
    const input = build({ stored: "default", planModeEnabled: false });
    expect(input.runtimeMode).toBe("approval-required");
    expect(input.modelSelection).toEqual({ instanceId, model: "gpt-5.5" });
    expect(input.message.text).toBe("Do the work");
  });
});
