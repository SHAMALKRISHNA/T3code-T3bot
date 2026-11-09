import type {
  ChatAttachment,
  ModelSelection,
  OrchestrationMessageContext,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";

import type { TurnCommandMetadata } from "../../lib/commandMetadata";
import { buildProjectThreadStartTurnInput } from "../../lib/projectThreadStartTurn";
import { resolvePendingTaskInteractionMode } from "../../state/legacy-plan-mode";

/**
 * Restarts a thread whose worktree setup was cancelled, in the project's own checkout. V2 accepts
 * a launch before setup, so this reuses the prompt and uploads the server already holds.
 */
export function buildWorkLocallyStartTurnInput(input: {
  readonly metadata: TurnCommandMetadata;
  readonly thread: {
    readonly projectId: ProjectId;
    readonly title: string;
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
  };
  readonly projectCwd: string;
  readonly message: {
    readonly text: string;
    readonly context?: OrchestrationMessageContext | undefined;
    readonly attachments: ReadonlyArray<ChatAttachment>;
  };
  readonly planModeEnabled: boolean;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const { metadata, thread, message } = input;
  return buildProjectThreadStartTurnInput({
    ...metadata,
    projectId: thread.projectId,
    projectCwd: input.projectCwd,
    text: message.text,
    titleText: thread.title,
    ...(message.context ? { context: message.context } : {}),
    uploadedAttachments: message.attachments,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: resolvePendingTaskInteractionMode({
      planModeEnabled: input.planModeEnabled,
      provider: input.providers.find(
        (provider) => provider.instanceId === thread.modelSelection.instanceId,
      ),
      draftInteractionMode: thread.interactionMode,
    }),
    workspaceMode: "local",
    branch: null,
    worktreePath: null,
    startFromOrigin: false,
    worktreeBranchName: "",
  });
}
