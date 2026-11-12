import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  storedMode: "plan" as string | null,
  saves: [] as Array<unknown>,
  saveFails: false,
  answer: null as unknown as (input: unknown) => unknown,
}));

vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() => async (value: { readonly input: unknown }) =>
    state.answer(value.input)) as never,
}));
vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  readThreadShell: (() =>
    state.storedMode === null ? null : { interactionMode: state.storedMode }) as never,
}));

import { render } from "../../../test/render";
import { __setClientSettingsForTests } from "../../hooks/useSettings";
import { useLeavePlanModeWhenOptedOut } from "./useLeavePlanModeWhenOptedOut";

state.answer = (input) => {
  state.saves.push(input);
  return state.saveFails
    ? AsyncResult.failure(Cause.fail(new Error("rejected")))
    : AsyncResult.success(undefined);
};

const threadRef = {
  environmentId: EnvironmentId.make("environment:test"),
  threadId: ThreadId.make("thread:test"),
};

function LeaveButton(props: { readonly onResult: (result: boolean) => void }) {
  const leave = useLeavePlanModeWhenOptedOut(threadRef.environmentId);
  return (
    <button type="button" onClick={() => void leave(threadRef).then(props.onResult)}>
      Leave
    </button>
  );
}

async function run(input: {
  readonly planModeEnabled: boolean;
  readonly storedMode: string | null;
  readonly saveFails?: boolean;
}) {
  state.saves = [];
  state.storedMode = input.storedMode;
  state.saveFails = input.saveFails === true;
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    planModeEnabled: input.planModeEnabled,
  });
  const onResult = vi.fn();
  await using screen = await render(<LeaveButton onResult={onResult} />);
  await screen.getByRole("button", { name: "Leave" }).click();
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
  return onResult.mock.calls[0]?.[0] as boolean;
}

it("saves default on a stored-plan thread while Plan mode is off", async () => {
  expect(await run({ planModeEnabled: false, storedMode: "plan" })).toBe(true);
  expect(state.saves).toEqual([
    expect.objectContaining({ threadId: threadRef.threadId, interactionMode: "default" }),
  ]);
});

it("stops the run when the save fails", async () => {
  expect(await run({ planModeEnabled: false, storedMode: "plan", saveFails: true })).toBe(false);
});

it("leaves the thread alone once opted in", async () => {
  expect(await run({ planModeEnabled: true, storedMode: "plan" })).toBe(true);
  expect(state.saves).toEqual([]);
});

it("has nothing to do on a thread already in default", async () => {
  expect(await run({ planModeEnabled: false, storedMode: "default" })).toBe(true);
  expect(state.saves).toEqual([]);
});
