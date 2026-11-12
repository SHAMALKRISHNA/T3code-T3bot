import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ readonly command: string; readonly input: unknown }>,
  rejected: null as string | null,
  // The server's fork copies the source thread's modes, which this shell stands in for.
  sideChat: { runtimeMode: "full-access", interactionMode: "plan" } as Record<string, string>,
}));

vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "uuid" }));
vi.mock("./threadForkNavigation", () => ({ waitForThreadShell: async () => true }));
vi.mock("./useOpenLinkedThread", () => ({ useOpenLinkedThread: () => () => undefined }));
vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: { get: () => state.sideChat } }));
vi.mock("../../state/threads", () => ({
  environmentThreadShells: { threadShellAtom: () => null },
  threadEnvironment: {
    forkSideChat: "forkSideChat",
    delete: "delete",
    setRuntimeMode: "setRuntimeMode",
    setInteractionMode: "setInteractionMode",
    startTurn: "startTurn",
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => async (value: { readonly input: unknown }) => {
    state.calls.push({ command, input: value.input });
    return command === state.rejected
      ? AsyncResult.failure(Cause.fail(new Error("rejected")))
      : AsyncResult.success(undefined);
  },
}));

import { useStartSideChat } from "./useStartSideChat";

const source = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("source"),
};
const settings = {
  runtimeMode: "full-access",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
} as const;
const order = () =>
  state.calls.map((call) => call.command).filter((command) => command !== "forkSideChat");

describe("useStartSideChat", () => {
  beforeEach(() => {
    state.calls = [];
    state.rejected = null;
    state.sideChat = { runtimeMode: "full-access", interactionMode: "plan" };
  });

  it("saves default before the first message of a side chat forked from a plan thread", async () => {
    expect(await useStartSideChat()(source, "why does this fail?", settings)).toBe(true);
    expect(order()).toEqual(["setInteractionMode", "startTurn"]);
    expect(state.calls.find((call) => call.command === "setInteractionMode")?.input).toMatchObject({
      interactionMode: "default",
    });
  });

  it("does not send, and drops the side chat, when saving the mode fails", async () => {
    state.rejected = "setInteractionMode";
    expect(await useStartSideChat()(source, "why does this fail?", settings)).toBe(false);
    expect(order()).toEqual(["setInteractionMode", "delete"]);
  });

  it("saves nothing when the forked thread is already in default", async () => {
    state.sideChat = { runtimeMode: "full-access", interactionMode: "default" };
    expect(await useStartSideChat()(source, "why does this fail?", settings)).toBe(true);
    expect(order()).toEqual(["startTurn"]);
  });
});
