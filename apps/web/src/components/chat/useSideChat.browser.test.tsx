import { EnvironmentId, ThreadId, type ProviderInteractionMode } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ readonly command: unknown; readonly input: unknown }>,
  rejected: null as unknown,
  sideChatMode: "plan" as ProviderInteractionMode,
  // Commands record themselves through this, set below once imports have run.
  answer: null as unknown as (command: unknown, input: unknown) => unknown,
}));

vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: ((command: unknown) => async (value: { readonly input: unknown }) =>
    state.answer(command, value.input)) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: ((command: unknown) => async (value: { readonly input: unknown }) =>
    state.answer(command, value.input)) as never,
}));
// The server's fork copies the source thread's modes, which this shell stands in for.
vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  waitForThreadShell: (async () => true) as never,
  readThreadShell: (() => ({
    runtimeMode: "full-access",
    interactionMode: state.sideChatMode,
  })) as never,
}));

import { render } from "../../../test/render";
import { threadEnvironment } from "../../state/threads";
import { useSideChat } from "./useSideChat";

state.answer = (command, input) => {
  state.calls.push({ command, input });
  return command === state.rejected
    ? AsyncResult.failure(Cause.fail(new Error("rejected")))
    : AsyncResult.success(undefined);
};

const threadRef = {
  environmentId: EnvironmentId.make("environment:test"),
  threadId: ThreadId.make("thread:source"),
};

function SideChatButton(props: { readonly prompt: string | undefined }) {
  const { open } = useSideChat({
    threadRef,
    readSettings: () => ({ runtimeMode: "full-access", modelSelection: undefined }),
    onError: () => undefined,
  });
  return (
    <button type="button" onClick={() => void open(props.prompt)}>
      Open
    </button>
  );
}

function setup(sideChatMode: ProviderInteractionMode, rejected: unknown = null) {
  state.calls = [];
  state.sideChatMode = sideChatMode;
  state.rejected = rejected;
}

const order = () =>
  state.calls.flatMap(({ command }) =>
    command === threadEnvironment.setInteractionMode
      ? ["setInteractionMode"]
      : command === threadEnvironment.startTurn
        ? ["startTurn"]
        : command === threadEnvironment.delete
          ? ["delete"]
          : [],
  );

it("saves default before the first message of a side chat forked from a plan thread", async () => {
  setup("plan");
  await using screen = await render(<SideChatButton prompt="why does this fail?" />);
  await screen.getByRole("button", { name: "Open" }).click();
  await vi.waitFor(() => expect(order()).toContain("startTurn"));
  expect(order()).toEqual(["setInteractionMode", "startTurn"]);
  expect(
    state.calls.find(({ command }) => command === threadEnvironment.setInteractionMode)?.input,
  ).toMatchObject({ interactionMode: "default" });
});

it("does not send, and drops the side chat, when saving the mode fails", async () => {
  setup("plan", threadEnvironment.setInteractionMode);
  await using screen = await render(<SideChatButton prompt="why does this fail?" />);
  await screen.getByRole("button", { name: "Open" }).click();
  await vi.waitFor(() => expect(order()).toEqual(["setInteractionMode", "delete"]));
});

it("saves nothing when the forked thread is already in default", async () => {
  setup("default");
  await using screen = await render(<SideChatButton prompt="why does this fail?" />);
  await screen.getByRole("button", { name: "Open" }).click();
  await vi.waitFor(() => expect(order()).toEqual(["startTurn"]));
});

it("leaves the mode to the composer's own send when no message goes out yet", async () => {
  setup("plan");
  await using screen = await render(<SideChatButton prompt={undefined} />);
  await screen.getByRole("button", { name: "Open" }).click();
  await vi.waitFor(() => expect(state.calls.length).toBeGreaterThan(0));
  expect(order()).toEqual([]);
});
