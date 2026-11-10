import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";

import * as MobilePreferences from "../persistence/mobile-preferences";
import * as Runtime from "../lib/runtime";

interface OptimisticPreferences {
  readonly values: Partial<MobilePreferences.Preferences>;
  readonly versions: Partial<Record<keyof MobilePreferences.Preferences, number>>;
}

// useAtomSet treats bare functions as AsyncResult updates; wrap preference transforms in payloads.
type PreferencesUpdate =
  | Partial<MobilePreferences.Preferences>
  | {
      readonly transform: (
        current: MobilePreferences.Preferences,
      ) => Partial<MobilePreferences.Preferences>;
    };

/** Keep optimistic patches separate so hydration cannot overwrite pending writes. */
export function createMobilePreferencesState(
  runtime: Atom.AtomRuntime<MobilePreferences.MobilePreferencesStore>,
) {
  // A failed read falls back to empty preferences, which would read as "never opted in". The
  // read keeps the failure beside the value, so both change in one update.
  const storedPreferencesAtom = runtime
    .atom(
      MobilePreferences.MobilePreferencesStore.pipe(
        Effect.flatMap((store) => store.load),
        Effect.map((preferences) => ({ preferences, loadFailed: false })),
        Effect.catch((error) =>
          Effect.logWarning("Could not load mobile preferences.", error).pipe(
            Effect.as({ preferences: {} as MobilePreferences.Preferences, loadFailed: true }),
          ),
        ),
      ),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("mobile:preferences:stored"));
  // Stays true while a retry is in flight, until the new value replaces the fallback.
  const loadFailedAtom = Atom.make((get) => {
    const read = get(storedPreferencesAtom);
    return AsyncResult.isSuccess(read) && read.value.loadFailed;
  }).pipe(Atom.keepAlive, Atom.withLabel("mobile:preferences:load-failed"));

  const optimisticPatchAtom = Atom.make<OptimisticPreferences>({ values: {}, versions: {} }).pipe(
    Atom.keepAlive,
    Atom.withLabel("mobile:preferences:optimistic-patch"),
  );
  const confirmedPreferencesAtom = Atom.make<MobilePreferences.Preferences>({}).pipe(
    Atom.keepAlive,
    Atom.withLabel("mobile:preferences:confirmed"),
  );
  let nextPatchVersion = 0;

  const preferencesAtom = Atom.make((get) => {
    const stored = get(storedPreferencesAtom);
    const confirmed = get(confirmedPreferencesAtom);
    const optimistic = get(optimisticPatchAtom);
    return AsyncResult.map(stored, ({ preferences }) => ({
      ...preferences,
      ...confirmed,
      ...optimistic.values,
    }));
  }).pipe(Atom.keepAlive, Atom.withLabel("mobile:preferences"));

  const updatePreferencesAtom = runtime
    .fn(
      (update: PreferencesUpdate, get) => {
        const currentPreferences = get(preferencesAtom);
        const patch =
          "transform" in update
            ? update.transform(
                AsyncResult.isSuccess(currentPreferences) ? currentPreferences.value : {},
              )
            : update;
        const version = ++nextPatchVersion;
        const current = get(optimisticPatchAtom);
        const versions = { ...current.versions };
        for (const key of Object.keys(patch) as Array<keyof MobilePreferences.Preferences>) {
          versions[key] = version;
        }
        get.set(optimisticPatchAtom, {
          values: { ...current.values, ...patch },
          versions,
        });
        return MobilePreferences.MobilePreferencesStore.pipe(
          Effect.flatMap((store) =>
            "transform" in update ? store.update(update.transform) : store.savePatch(patch),
          ),
          Effect.tap((saved) =>
            Effect.sync(() => {
              get.set(confirmedPreferencesAtom, saved);
              const optimistic = get(optimisticPatchAtom);
              const values = { ...optimistic.values } as Record<string, unknown>;
              const currentVersions = { ...optimistic.versions } as Record<string, unknown>;
              for (const key of Object.keys(patch) as Array<keyof MobilePreferences.Preferences>) {
                if (optimistic.versions[key] === version) {
                  delete values[key];
                  delete currentVersions[key];
                }
              }
              get.set(optimisticPatchAtom, {
                values: values as Partial<MobilePreferences.Preferences>,
                versions: currentVersions as Partial<
                  Record<keyof MobilePreferences.Preferences, number>
                >,
              });
            }),
          ),
          Effect.tapError(() =>
            Effect.sync(() => {
              const optimistic = get(optimisticPatchAtom);
              const values = { ...optimistic.values } as Record<string, unknown>;
              const currentVersions = { ...optimistic.versions } as Record<string, unknown>;
              for (const key of Object.keys(patch) as Array<keyof MobilePreferences.Preferences>) {
                if (optimistic.versions[key] === version) {
                  delete values[key];
                  delete currentVersions[key];
                }
              }
              get.set(optimisticPatchAtom, {
                values: values as Partial<MobilePreferences.Preferences>,
                versions: currentVersions as Partial<
                  Record<keyof MobilePreferences.Preferences, number>
                >,
              });
            }),
          ),
        );
      },
      // Storage serializes shared-blob updates; keep concurrent invocations alive to prevent cross-field interruption.
      { concurrent: true },
    )
    .pipe(Atom.keepAlive, Atom.withLabel("mobile:preferences:update"));

  return { preferencesAtom, updatePreferencesAtom, loadFailedAtom, storedPreferencesAtom } as const;
}

const mobilePreferencesRuntime = Atom.runtime(Runtime.layer);
const mobilePreferencesState = createMobilePreferencesState(mobilePreferencesRuntime);

export const mobilePreferencesAtom = mobilePreferencesState.preferencesAtom;
export const mobilePreferencesLoadFailedAtom = mobilePreferencesState.loadFailedAtom;
/** Refresh this to read stored preferences again after a failed load. */
export const mobilePreferencesStoredAtom = mobilePreferencesState.storedPreferencesAtom;
export const updateMobilePreferencesAtom = mobilePreferencesState.updatePreferencesAtom;
