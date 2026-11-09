import { createMemoryHistory } from "@tanstack/react-router";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  NodeId,
  PlanId,
  ProviderInstanceId,
  ProviderSessionId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2Command,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import { draftFanoutSelectionsAtom } from "~/components/chat/chatViewSend";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  rejectCommands,
  rejectThreadLaunches,
  threadWithHistory,
  userItem,
  type FakeDriver,
  type FakeThread,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const AT = DateTime.makeUnsafe("2026-03-17T19:12:28.000Z");

function pendingRequest(
  id: string,
  kind: OrchestrationV2RuntimeRequest["kind"],
  supportsFeedback = false,
): OrchestrationV2RuntimeRequest {
  return {
    id: RuntimeRequestId.make(id),
    nodeId: NodeId.make(`${id}-node`),
    providerTurnId: null,
    nativeRequestRef: null,
    kind,
    status: "pending",
    responseCapability: {
      type: "live",
      providerSessionId: ProviderSessionId.make(`${id}-session`),
      ...(supportsFeedback ? { supportsFeedback: true } : {}),
    },
    createdAt: AT,
    resolvedAt: null,
  };
}

function withApproval(name: string, supportsFeedback: boolean): FakeThread {
  return {
    ...threadWithHistory(name, 1),
    runtimeRequests: [pendingRequest(`${name}-approval`, "command", supportsFeedback)],
  };
}

function withQuestion(name: string): FakeThread {
  const thread = threadWithHistory(name, 1);
  const requestId = `${name}-question`;
  const question = {
    ...userItem(thread.id, thread.runs[0]!.id, requestId, 10, ""),
    type: "user_input_request",
    requestId: RuntimeRequestId.make(requestId),
    questions: [
      {
        id: "language",
        header: "Language",
        question: "Which language?",
        options: [{ label: "TypeScript", description: "Use the existing code" }],
        multiSelect: false,
      },
    ],
  } as unknown as OrchestrationV2TurnItem;
  return {
    ...thread,
    items: [...thread.items, question],
    runtimeRequests: [pendingRequest(requestId, "user_input")],
  };
}

function withPlan(name: string, overrides?: Partial<FakeThread>): FakeThread {
  const thread = threadWithHistory(name, 1);
  return {
    ...thread,
    interactionMode: "plan",
    plans: [
      {
        id: PlanId.make(`${name}-plan`),
        threadId: thread.id,
        runId: thread.runs[0]!.id,
        nodeId: NodeId.make(`${name}-plan-node`),
        status: "active",
        kind: "proposed_plan",
        markdown: `# Plan for ${name}\n\n- ship it`,
      },
    ],
    ...overrides,
  };
}

const inlinePlan = threadWithHistory("thread-inline-plan", 1);
const inlineDefault = {
  ...threadWithHistory("thread-inline-default", 1),
  interactionMode: "plan" as const,
};
const inlineRetry = threadWithHistory("thread-inline-retry", 1);
const approvalRedirect = withApproval("thread-approval-redirect", false);
const approvalFeedback = withApproval("thread-approval-feedback", true);
const approvalMenu = withApproval("thread-approval-menu", true);
const question = withQuestion("thread-question");
const supervisedPlan = withPlan("thread-supervised-plan", { runtimeMode: "approval-required" });
function withResumablePlan(name: string): FakeThread {
  const thread = withPlan(name);
  return {
    ...thread,
    runs: thread.runs.map((run) => ({ ...run, status: "interrupted" as const })),
  };
}
const resumablePlan = withResumablePlan("thread-resumable-plan");
const resumablePlanHint = withResumablePlan("thread-resumable-plan-hint");

// The app's shell subscription outlives a test, so it lists every test's thread from the start.
installFakeEnvironment(
  [
    inlinePlan,
    inlineDefault,
    inlineRetry,
    approvalRedirect,
    approvalFeedback,
    approvalMenu,
    question,
    supervisedPlan,
    resumablePlan,
    resumablePlanHint,
  ],
  { acceptCommands: true, requiredWorktreeBootstrap: true },
);
await page.viewport(1400, 900);

async function mount(path: string) {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    planModeEnabled: true,
  });
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  return render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
}

async function openThread(thread: FakeThread) {
  const app = await mount(`/${ENVIRONMENT_ID}/${thread.id}`);
  await expect.element(page.getByText(`Answer 0 for ${thread.id}.`)).toBeVisible();
  await userEvent.click(page.getByTestId("composer-editor"));
  return app;
}

async function typeAndPressEnter(text: string) {
  await userEvent.keyboard(text);
  await userEvent.keyboard("{Enter}");
}

const commandsFor = (threadId: ThreadId) =>
  dispatchedCommands().filter(
    (command): command is Extract<OrchestrationV2Command, { readonly threadId: ThreadId }> =>
      "threadId" in command && command.threadId === threadId,
  );
const sentTexts = (threadId: ThreadId) =>
  commandsFor(threadId).flatMap((command) =>
    command.type === "message.dispatch" ? [command.text] : [],
  );
const modeWrites = (threadId: ThreadId) =>
  commandsFor(threadId).flatMap((command) =>
    command.type === "thread.interaction-mode.set" ? [command.interactionMode] : [],
  );
const approvalReplies = (threadId: ThreadId) =>
  commandsFor(threadId).flatMap((command) =>
    command.type === "runtime-request.respond" ? [command] : [],
  );
const draftMode = (threadId: ThreadId) =>
  useComposerDraftStore.getState().getComposerDraft(scopeThreadRef(ENVIRONMENT_ID, threadId))
    ?.interactionMode ?? null;
const draftPrompt = (threadId: ThreadId) =>
  useComposerDraftStore.getState().getComposerDraft(scopeThreadRef(ENVIRONMENT_ID, threadId))
    ?.prompt ?? "";

it("an inline /plan switches the thread, not just its one message", async () => {
  await using _app = await openThread(inlinePlan);
  await typeAndPressEnter("/plan inspect the code");
  await vi.waitFor(() => expect(sentTexts(inlinePlan.id)).toEqual(["inspect the code"]));
  expect(modeWrites(inlinePlan.id)).toEqual(["plan"]);
  expect(draftMode(inlinePlan.id)).toBe("plan");
});

it("an inline /default leaves plan mode for the following messages too", async () => {
  useComposerDraftStore
    .getState()
    .setInteractionMode(scopeThreadRef(ENVIRONMENT_ID, inlineDefault.id), "plan");
  await using _app = await openThread(inlineDefault);
  await typeAndPressEnter("/default do it");
  await vi.waitFor(() => expect(sentTexts(inlineDefault.id)).toEqual(["do it"]));
  expect(draftMode(inlineDefault.id)).toBe("default");
});

it("a failed inline /plan comes back in plan mode, so the retry still plans", async () => {
  using _rejected = rejectCommands((command) => command.type === "message.dispatch");
  await using _app = await openThread(inlineRetry);
  await typeAndPressEnter("/plan inspect the code");
  await vi.waitFor(() => expect(draftPrompt(inlineRetry.id)).toBe("inspect the code"));
  expect(draftMode(inlineRetry.id)).toBe("plan");
});

it("a failed inline /plan on a new thread keeps the draft in plan mode", async () => {
  const draftId = DraftId.make("draft-inline-plan");
  const threadId = ThreadId.make("thread-draft-inline-plan");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, { threadId });
  using _rejected = rejectThreadLaunches();
  await using _app = await mount(`/draft/${draftId}`);
  await userEvent.click(page.getByTestId("composer-editor"));
  await typeAndPressEnter("/plan inspect the code");
  await vi.waitFor(() => {
    const draft = useComposerDraftStore.getState().getComposerDraft(draftId);
    expect(draft?.prompt).toBe("inspect the code");
    expect(draft?.interactionMode).toBe("plan");
  });
  expect(useComposerDraftStore.getState().getDraftSession(draftId)?.interactionMode).toBe("plan");
});

it("a redirect that starts with /plan reaches the agent as written", async () => {
  await using _app = await openThread(approvalRedirect);
  await typeAndPressEnter("/plan use the other file");
  await vi.waitFor(() =>
    expect(sentTexts(approvalRedirect.id)).toEqual(["/plan use the other file"]),
  );
  expect(modeWrites(approvalRedirect.id)).not.toContain("plan");
  expect(draftMode(approvalRedirect.id)).toBeNull();
});

it("a lone /plan answers an approval as its feedback instead of switching modes", async () => {
  await using _app = await openThread(approvalFeedback);
  // The space closes the slash menu, so Enter sends.
  await typeAndPressEnter("/plan ");
  await vi.waitFor(() =>
    expect(approvalReplies(approvalFeedback.id)).toEqual([
      expect.objectContaining({ decision: "decline", feedback: "/plan" }),
    ]),
  );
  expect(draftMode(approvalFeedback.id)).toBeNull();
});

it("the slash menu cannot replace an approval reply with a mode switch", async () => {
  await using _app = await openThread(approvalMenu);
  await typeAndPressEnter("/plan");
  await vi.waitFor(() =>
    expect(approvalReplies(approvalMenu.id)).toEqual([
      expect.objectContaining({ decision: "decline", feedback: "/plan" }),
    ]),
  );
  expect(draftMode(approvalMenu.id)).toBeNull();
});

it("the slash menu cannot erase a typed answer to a question", async () => {
  await using _app = await openThread(question);
  await typeAndPressEnter("/plan");
  await vi.waitFor(() =>
    expect(approvalReplies(question.id)).toEqual([
      expect.objectContaining({ answers: { language: "/plan" } }),
    ]),
  );
  expect(draftMode(question.id)).toBeNull();
});

it("implementing in a new thread keeps the approvals the source thread runs under", async () => {
  await using _app = await openThread(supervisedPlan);
  await page.getByRole("button", { name: "Implementation actions" }).click();
  await page.getByRole("menuitem", { name: "Implement in a new thread" }).click();
  await vi.waitFor(() =>
    expect(dispatchedCommands().filter((command) => command.type === "thread.create")).toEqual([
      expect.objectContaining({ runtimeMode: "approval-required" }),
    ]),
  );
});

it("Enter on an empty composer never implements while Resume owns the primary action", async () => {
  await using _app = await openThread(resumablePlan);
  await expect.element(page.getByRole("button", { name: "Resume thread" })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await page.getByRole("button", { name: "Resume thread" }).click();
  // Only the resume reaches the server: Enter sent no implementation message before it.
  await vi.waitFor(() =>
    expect(sentTexts(resumablePlan.id)).toEqual(["Continue where you left off."]),
  );
});

it("the composer hint stops promising that a blank send implements while Resume is offered", async () => {
  await using _app = await openThread(resumablePlanHint);
  await expect.element(page.getByRole("button", { name: "Resume thread" })).toBeVisible();
  await expect
    .element(page.getByTestId("composer-editor"))
    .toHaveAttribute("aria-placeholder", "Add feedback to refine the plan");
});

it("a typed /plan switches modes while multiple models are selected", async () => {
  const draftId = DraftId.make("draft-fanout");
  const threadId = ThreadId.make("thread-draft-fanout");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, {
      threadId,
      branch: "main",
    });
  const instanceId = ProviderInstanceId.make("codex");
  appAtomRegistry.set(
    draftFanoutSelectionsAtom(scopedThreadKey(scopeThreadRef(ENVIRONMENT_ID, threadId))),
    [
      { instanceId, model: "gpt-5.4" },
      { instanceId, model: "gpt-5.5" },
    ],
  );
  await using _app = await mount(`/draft/${draftId}`);
  await userEvent.click(page.getByTestId("composer-editor"));
  // The space closes the slash menu, so Enter reaches the send path.
  await typeAndPressEnter("/plan ");
  await vi.waitFor(() =>
    expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.interactionMode).toBe(
      "plan",
    ),
  );
  expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.prompt ?? "").toBe("");
});
