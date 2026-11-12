import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { readThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";

/**
 * For actions that start a run without passing a mode: the server uses the thread's saved mode.
 * Resolves whether the action may go ahead, having saved default on a stored-plan thread if this
 * client has not opted in.
 */
export function useLeavePlanModeWhenOptedOut(environmentId: EnvironmentId) {
  const planModeEnabled = useEnvironmentSettings(
    environmentId,
    (settings) => settings.planModeEnabled,
  );
  const setInteractionMode = useOrchestrationCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });

  return async (target: ScopedThreadRef): Promise<boolean> => {
    if (planModeEnabled || readThreadShell(target)?.interactionMode !== "plan") return true;
    const saved = await setInteractionMode({
      environmentId: target.environmentId,
      input: {
        threadId: target.threadId,
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      },
    });
    return saved._tag !== "Failure";
  };
}
