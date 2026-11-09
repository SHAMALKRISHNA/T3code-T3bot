import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
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

// Its own file: the provider's commands come from the config the connection keeps.
const planOn = threadWithHistory("thread-provider-plan-on", 1);
const planOff = threadWithHistory("thread-provider-plan-off", 1);
installFakeEnvironment([planOn, planOff], {
  acceptCommands: true,
  providerSlashCommands: [
    { name: "plan", description: "Native plan" },
    { name: "DEFAULT", description: "Native default" },
    { name: "review", description: "Native review" },
  ],
});
await page.viewport(1400, 900);

function useSettings(planModeEnabled: boolean) {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    planModeEnabled,
  });
}

async function openThread(threadId: string) {
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${threadId}`] }),
  );
  await router.load();
  const app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText(`Answer 0 for ${threadId}.`)).toBeVisible();
  await userEvent.click(page.getByTestId("composer-editor"));
  return app;
}

const menuItemIds = () =>
  [...document.querySelectorAll("[data-composer-item-id]")].map((item) =>
    item.getAttribute("data-composer-item-id"),
  );

it("offers one /plan and /default, T3's, while its mode commands would consume the text", async () => {
  useSettings(true);
  await using _app = await openThread(planOn.id);
  await userEvent.keyboard("/");
  await vi.waitFor(() => expect(menuItemIds()).toContain("slash:plan"));
  expect(menuItemIds()).toContain("slash:default");
  expect(menuItemIds()).toContain("provider-slash-command:codex:review");
  expect(menuItemIds()).not.toContain("provider-slash-command:codex:plan");
  expect(menuItemIds()).not.toContain("provider-slash-command:codex:DEFAULT");
});

it("leaves the provider's own /plan and /default available with Plan mode off", async () => {
  useSettings(false);
  await using _app = await openThread(planOff.id);
  await userEvent.keyboard("/");
  await vi.waitFor(() => expect(menuItemIds()).toContain("provider-slash-command:codex:plan"));
  expect(menuItemIds()).toContain("provider-slash-command:codex:DEFAULT");
  expect(menuItemIds()).not.toContain("slash:plan");
  expect(menuItemIds()).not.toContain("slash:default");
});
