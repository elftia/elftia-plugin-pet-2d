/**
 * src/contract/facts.ts — local structural mirrors of the host's workbench
 * facts protocol (`HOST_WT/packages/shared/src/contracts/pet-facts.ts`,
 * `@elftia/shared`'s `pet-facts` contract) and of the host's own LOWER-BOUND
 * mirror of it (`@elftia/plugin-types/host-api/pet-runtime.ts`,
 * `HostPetFactEntryLike` / `HostPetFactsSnapshotLike`).
 *
 * Deliberately a THIRD copy, not a `type` import of either: the plugin has
 * no access to `@elftia/shared` at all (it is a host-internal package, never
 * shipped to plugins), and importing `plugin-types`' version here would tie
 * `src/contract`/`src/brain` — meant to be the most portable, copy-into-
 * any-other-plugin part of this repo (D2/D14) — to a `tsconfig.json` `paths`
 * mapping that exists only in THIS repo. A reader porting `src/brain/
 * sense.ts` elsewhere should not have to bring a path mapping with it.
 *
 * `PET_FACT_TYPES` is pinned by a test (`__tests__/facts.test.ts`) against
 * the authoritative list at
 * `HOST_WT/packages/shared/src/contracts/pet-facts.ts:40-49` — if the host
 * adds, removes, or renames a fact type, that test fails here first.
 */

/**
 * The closed v1 fact-type enum (`PetFactTypeSchema`, pet-facts.ts:40-49).
 * `deriveSense`'s `FACT_FLAGS` table (D3, `src/brain/sense.ts`) is keyed by
 * this union; a future fact type present in a live snapshot but absent from
 * this list simply matches no table row and is ignored — see
 * `PetFactEntryLike.type` below, which stays `string` for exactly that
 * forward-compatibility reason.
 */
export const PET_FACT_TYPES = [
  'taskCompleted',
  'taskFailed',
  'sessionThinking',
  'sessionWaitingApproval',
  'turnCompleted',
  'mediaJobCompleted',
  'requestError',
  'appLifecycle',
] as const;

export type PetFactType = (typeof PET_FACT_TYPES)[number];

/**
 * Bounded discriminator payload (`PetFactDetailsSchema`, pet-facts.ts:57-61).
 * Values are enums / opaque ids / numbers / booleans only — never free text.
 * The one field `deriveSense` reads today is `appLifecycle`'s
 * `{ phase: 'started' | 'quitting' }`.
 */
export type PetFactDetails = Readonly<Record<string, string | number | boolean>>;

/**
 * One windowed fact assertion (`PetFactEntry`, pet-facts.ts:68-82). Mirrors
 * the wire shape exactly — unlike the host's own `HostPetFactEntryLike`
 * (plugin-types' deliberately loose LOWER BOUND, `[key: string]: unknown`
 * tail and all), this local copy types `since` / `occurredAt` / `details`
 * concretely because `deriveSense` (D3) reads all of them by name.
 *
 * `type` stays `string`, not `PetFactType`: a snapshot is trusted to carry
 * known types today, but a future host MINOR bump can add one this plugin
 * has never heard of, and `FACT_FLAGS` (`sense.ts`) is written to silently
 * ignore any type it does not recognize rather than reject the snapshot —
 * see `isKnownPetFactType` below.
 */
export interface PetFactEntryLike {
  readonly type: string;
  readonly id: string;
  readonly active: boolean;
  readonly since?: number;
  readonly occurredAt?: number;
  readonly deadline: number;
  readonly details?: PetFactDetails;
}

/** Full snapshot (`PetFactsSnapshot`, pet-facts.ts:85-93). */
export interface PetFactsSnapshotLike {
  readonly apiVersion: number;
  readonly revision: number;
  readonly generatedAt: number;
  readonly facts: ReadonlyArray<PetFactEntryLike>;
}

/**
 * Narrows a fact's `type` to the known union. `FACT_FLAGS` (`sense.ts`)
 * uses this so an unrecognized `type` degrades to "no flag set" instead of
 * an `undefined` table lookup silently doing the same thing less legibly.
 */
export function isKnownPetFactType(value: string): value is PetFactType {
  return (PET_FACT_TYPES as readonly string[]).includes(value);
}
