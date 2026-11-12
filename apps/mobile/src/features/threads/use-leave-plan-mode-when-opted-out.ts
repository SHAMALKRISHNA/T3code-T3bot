import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { appAtomRegistry } from "../../state/atom-registry";
import { resolvePlanModeOptIn } from "../../state/legacy-plan-mode";
import { mobilePreferencesAtom, mobilePreferencesLoadFailedAtom } from "../../state/preferences";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * For actions that start a run without passing a mode: the server uses the thread's saved mode.
 * Resolves whether the action may go ahead, having saved default on a stored-plan thread if this
 * device has not opted in. With the opt-in unreadable it refuses, since either mode could be wrong.
 */
export function useLeavePlanModeWhenOptedOut() {
  const optIn = resolvePlanModeOptIn(
    useAtomValue(mobilePreferencesAtom),
    useAtomValue(mobilePreferencesLoadFailedAtom),
  );
  const setInteractionMode = useAtomCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });

  return async (target: ScopedThreadRef): Promise<boolean> => {
    if (optIn === "on") return true;
    const shell = appAtomRegistry.get(environmentThreadShells.threadShellAtom(target));
    if (shell?.interactionMode !== "plan") return true;
    if (optIn !== "off") {
      Dialog.alert(
        "Plan Mode setting unavailable",
        "This thread is in plan mode and the Plan Mode setting could not be read. Turn Plan Mode on or off in Settings, then try again.",
      );
      return false;
    }
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
