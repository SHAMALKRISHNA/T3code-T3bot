import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  preferences: null as unknown,
  loadFailed: false,
  shell: { interactionMode: "plan" } as { readonly interactionMode: string } | null,
  saves: [] as Array<unknown>,
  saveFails: false,
  alert: vi.fn(),
}));

vi.mock("../../components/ui/Dialog", () => ({ alert: state.alert }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) => (atom === "failed" ? state.loadFailed : state.preferences),
}));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: "preferences",
  mobilePreferencesLoadFailedAtom: "failed",
}));
vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: { get: () => state.shell } }));
vi.mock("../../state/threads", () => ({
  environmentThreadShells: { threadShellAtom: () => null },
  threadEnvironment: { setInteractionMode: "setInteractionMode" },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async (value: { readonly input: unknown }) => {
    state.saves.push(value.input);
    return state.saveFails
      ? AsyncResult.failure(Cause.fail(new Error("rejected")))
      : AsyncResult.success(undefined);
  },
}));

import { useLeavePlanModeWhenOptedOut } from "./use-leave-plan-mode-when-opted-out";

const target = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };

describe("useLeavePlanModeWhenOptedOut", () => {
  beforeEach(() => {
    state.preferences = AsyncResult.success({});
    state.loadFailed = false;
    state.shell = { interactionMode: "plan" };
    state.saves = [];
    state.saveFails = false;
    state.alert.mockClear();
  });

  it("saves default on a stored-plan thread while Plan mode is off", async () => {
    expect(await useLeavePlanModeWhenOptedOut()(target)).toBe(true);
    expect(state.saves).toEqual([
      expect.objectContaining({ threadId: "thread", interactionMode: "default" }),
    ]);
  });

  it("stops the run when the save fails", async () => {
    state.saveFails = true;
    expect(await useLeavePlanModeWhenOptedOut()(target)).toBe(false);
  });

  it("leaves the thread alone once opted in", async () => {
    state.preferences = AsyncResult.success({ planModeEnabled: true });
    expect(await useLeavePlanModeWhenOptedOut()(target)).toBe(true);
    expect(state.saves).toEqual([]);
  });

  it("has nothing to do on a thread already in default", async () => {
    state.shell = { interactionMode: "default" };
    expect(await useLeavePlanModeWhenOptedOut()(target)).toBe(true);
    expect(state.saves).toEqual([]);
  });

  it("stops the run and says why when the preference could not be read", async () => {
    state.loadFailed = true;
    expect(await useLeavePlanModeWhenOptedOut()(target)).toBe(false);
    expect(state.saves).toEqual([]);
    expect(state.alert).toHaveBeenCalledOnce();
  });
});
