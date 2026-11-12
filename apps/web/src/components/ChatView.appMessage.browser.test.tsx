import { createMemoryHistory } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { OrchestrationV2TurnItem, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import { useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  rejectCommands,
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

// Only the sandboxed iframe is stubbed: this button stands in for an app's `ui/message`, after
// the user has approved it. Everything from the prop to the socket is the real ChatView path.
vi.mock("~/components/chat/McpAppFrame", () => ({
  McpAppFrame: (props: { readonly onSendMessage?: (text: string) => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        void props.onSendMessage?.("from the app").catch(() => undefined);
      }}
    >
      Send from the app
    </button>
  ),
}));

function withApp(name: string, overrides?: Partial<FakeThread>): FakeThread {
  const thread = threadWithHistory(name, 1);
  const app = {
    ...userItem(thread.id, thread.runs[0]!.id, `${name}-app`, 10, ""),
    type: "dynamic_tool",
    toolName: "weather.get_weather",
    input: {},
    output: {
      t3McpApp: {
        attachmentId: `${name}-html`,
        server: "weather",
        tool: "get_weather",
        resourceUri: "ui://weather/dashboard",
      },
    },
  } as unknown as OrchestrationV2TurnItem;
  return { ...thread, items: [...thread.items, app], ...overrides };
}

const optedOut = withApp("thread-app-opted-out", { interactionMode: "plan" });
const optedOutFails = withApp("thread-app-opted-out-fails", { interactionMode: "plan" });
const optedIn = withApp("thread-app-opted-in", { interactionMode: "plan" });
const keepsApprovals = withApp("thread-app-keeps-approvals", { interactionMode: "plan" });

// The app's shell subscription outlives a test, so it lists every test's thread from the start.
installFakeEnvironment([optedOut, optedOutFails, optedIn, keepsApprovals], {
  acceptCommands: true,
});
await page.viewport(1400, 900);

async function openThread(thread: FakeThread, planModeEnabled: boolean) {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    planModeEnabled,
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  const app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByRole("button", { name: "Send from the app" })).toBeVisible();
  return app;
}

/** The commands that decide what a turn runs in, in the order the server would apply them. */
const commandsFor = (threadId: ThreadId) =>
  dispatchedCommands().flatMap((command) => {
    if (!("threadId" in command) || command.threadId !== threadId) return [];
    if (command.type === "thread.interaction-mode.set") return [`mode:${command.interactionMode}`];
    if (command.type === "thread.runtime-mode.set") return [`runtime:${command.runtimeMode}`];
    if (command.type === "message.dispatch") return [`message:${command.text}`];
    return [];
  });

it("saves default before an app's message on a stored-plan thread with Plan mode off", async () => {
  await using _app = await openThread(optedOut, false);
  await page.getByRole("button", { name: "Send from the app" }).click();
  await vi.waitFor(() => expect(commandsFor(optedOut.id)).toContain("message:from the app"));
  expect(commandsFor(optedOut.id)).toEqual(["mode:default", "message:from the app"]);
});

it("does not send an app's message when saving the mode fails", async () => {
  using _rejected = rejectCommands((command) => command.type === "thread.interaction-mode.set");
  await using _app = await openThread(optedOutFails, false);
  await page.getByRole("button", { name: "Send from the app" }).click();
  await vi.waitFor(() => expect(commandsFor(optedOutFails.id)).toEqual(["mode:default"]));
  // A later send proves the failed one has finished: only its own message follows the mode write.
  rejectCommands(() => false);
  await page.getByRole("button", { name: "Send from the app" }).click();
  await vi.waitFor(() => expect(commandsFor(optedOutFails.id).at(-1)).toBe("message:from the app"));
  expect(commandsFor(optedOutFails.id).filter((entry) => entry.startsWith("message:"))).toEqual([
    "message:from the app",
  ]);
});

it("leaves a stored plan mode alone for an app's message once Plan mode is on", async () => {
  await using _app = await openThread(optedIn, true);
  await page.getByRole("button", { name: "Send from the app" }).click();
  await vi.waitFor(() => expect(commandsFor(optedIn.id)).toEqual(["message:from the app"]));
});

it("does not change the thread's approvals for an app's message", async () => {
  useComposerDraftStore
    .getState()
    .setRuntimeMode(scopeThreadRef(ENVIRONMENT_ID, keepsApprovals.id), "approval-required");
  await using _app = await openThread(keepsApprovals, false);
  await page.getByRole("button", { name: "Send from the app" }).click();
  await vi.waitFor(() => expect(commandsFor(keepsApprovals.id)).toContain("message:from the app"));
  expect(commandsFor(keepsApprovals.id).filter((entry) => entry.startsWith("runtime:"))).toEqual(
    [],
  );
});
