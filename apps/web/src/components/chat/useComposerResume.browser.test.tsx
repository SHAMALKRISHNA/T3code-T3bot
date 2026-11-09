import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  startedTurn: null as ReturnType<typeof deferred<unknown>> | null,
  order: [] as string[],
}));

vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() => async (value: { readonly input: unknown }) => {
    state.order.push("command");
    state.startedTurn?.resolve(value.input);
    return AsyncResult.success(undefined);
  }) as never,
}));

import { render } from "../../../test/render";
import type { ComposerHandleRef } from "../../composerHandleContext";
import { useComposerResume } from "./useComposerResume";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setup() {
  const startedTurn = deferred<unknown>();
  state.startedTurn = startedTurn;
  return { startedTurn };
}

const threadA = ThreadId.make("thread:a");
const threadAModel = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" };
const threadBModel = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus" };

function composerShowing(selectedModelSelection: typeof threadAModel) {
  return { getSendContext: () => ({ selectedModelSelection }) } as never;
}

function ResumeButton(props: {
  readonly composerRef: ComposerHandleRef;
  readonly persistSettings: (input: {
    readonly runtimeMode: string;
    readonly interactionMode: string;
  }) => Promise<AtomCommandResult<void, unknown>>;
  /** Only a held queue is left to resume, with no interrupted run to continue. */
  readonly queueOnly?: boolean;
}) {
  const { onResume } = useComposerResume({
    environmentId: EnvironmentId.make("environment:test"),
    routeThreadKey: `environment:test:thread:a:${props.queueOnly === true}`,
    currentRouteThreadKeyRef: { current: `environment:test:thread:a:${props.queueOnly === true}` },
    activeThread: { id: threadA, runtimeMode: "approval-required" } as never,
    resumableRunId: props.queueOnly === true ? null : RunId.make("run:interrupted"),
    hasHeldQueuedRuns: props.queueOnly === true,
    isSendBusy: false,
    isRevertingCheckpoint: false,
    threadDetailLoading: false,
    activeEnvironmentUnavailable: false,
    runtimeMode: "full-access",
    interactionMode: "default",
    localCheckoutBranchMismatch: null,
    composerRef: props.composerRef,
    persistThreadSettingsForNextTurn: props.persistSettings,
    clearUsageLimitsFor: () => undefined,
    scrollToEnd: () => undefined,
    setThreadError: () => undefined,
  });
  return (
    <button type="button" onClick={() => void onResume()}>
      Resume
    </button>
  );
}

it("continues on the resumed thread's model after the composer moves to another thread", async () => {
  const { startedTurn } = setup();
  const settingsPersisted = deferred<AtomCommandResult<void, unknown>>();
  // ChatView keeps one composer across thread routes, so its ref follows navigation.
  const composerRef: ComposerHandleRef = { current: composerShowing(threadAModel) };
  await using screen = await render(
    <ResumeButton composerRef={composerRef} persistSettings={() => settingsPersisted.promise} />,
  );

  await screen.getByRole("button", { name: "Resume" }).click();
  composerRef.current = composerShowing(threadBModel);
  settingsPersisted.resolve(AsyncResult.success(undefined));

  expect(await startedTurn.promise).toMatchObject({
    threadId: threadA,
    manualContinuationOfRunId: "run:interrupted",
    modelSelection: threadAModel,
  });
});

it("saves the composer's mode before resuming a held queue, and keeps the thread's approvals", async () => {
  const { startedTurn } = setup();
  state.order = [];
  const persistSettings = vi.fn(async () => {
    state.order.push("persist");
    return AsyncResult.success(undefined);
  });
  await using screen = await render(
    <ResumeButton
      composerRef={{ current: composerShowing(threadAModel) }}
      persistSettings={persistSettings}
      queueOnly
    />,
  );

  await screen.getByRole("button", { name: "Resume" }).click();

  expect(await startedTurn.promise).toEqual({ threadId: threadA });
  expect(state.order).toEqual(["persist", "command"]);
  expect(persistSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      threadId: threadA,
      interactionMode: "default",
      runtimeMode: "approval-required",
    }),
  );
});
