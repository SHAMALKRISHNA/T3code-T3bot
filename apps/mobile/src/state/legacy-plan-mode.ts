import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ProviderInteractionMode,
  type ServerProvider,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

type InteractionModeProvider = Pick<ServerProvider, "showInteractionModeToggle">;

export function resolveProviderInteractionMode(
  provider: InteractionModeProvider | null | undefined,
  interactionMode: ProviderInteractionMode | null | undefined,
): ProviderInteractionMode {
  return provider?.showInteractionModeToggle === false
    ? DEFAULT_PROVIDER_INTERACTION_MODE
    : (interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE);
}

/**
 * What is known about this device's opt-in. "pending": still loading. "unknown": the stored
 * value could not be read, so an empty preference does not mean the user never opted in.
 */
export type PlanModeOptIn = "pending" | "unknown" | "on" | "off";

export function resolvePlanModeOptIn(
  preferences: AsyncResult.AsyncResult<{ readonly planModeEnabled?: boolean }, unknown>,
  loadFailed: boolean,
): PlanModeOptIn {
  if (AsyncResult.isFailure(preferences)) return "unknown";
  if (!AsyncResult.isSuccess(preferences)) return "pending";
  const { planModeEnabled } = preferences.value;
  if (planModeEnabled === undefined && loadFailed) return "unknown";
  return planModeEnabled === true ? "on" : "off";
}

export function resolveLegacyPlanModeEnabled(input: {
  readonly loaded: boolean;
  readonly preference: boolean | undefined;
}): boolean {
  return input.loaded && input.preference === true;
}

export function resolvePendingTaskInteractionMode(input: {
  readonly planModeEnabled: boolean;
  readonly draftInteractionMode: ProviderInteractionMode | undefined;
  readonly provider?: InteractionModeProvider | null;
}): ProviderInteractionMode {
  if (input.provider?.showInteractionModeToggle === false || !input.planModeEnabled) {
    return DEFAULT_PROVIDER_INTERACTION_MODE;
  }
  return input.draftInteractionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
}
