/**
 * src/manager/studio/StateSlotGrid.tsx — step 2 of the six-step flow
 * (D7.2): all 15 state rows, one row per `PetState`, with the contract's
 * gating expressed AS UI state (not just validation text): pingpong/blink
 * options disable at frames < 2, the motion select disables unless
 * frames === 1 (except `error`), and every edit rides `normalizeSlot` so
 * the draft self-heals out of combinations the contract forbids. The bulk
 * "copy idle → unassigned" action is the duplicate-from-base path (a
 * whale-girl atlas commonly has one base sheet).
 */
import {
  MOTION_ON_MULTI_FRAME_EXCEPTION,
  MOTION_RECIPES,
  PET_STATES,
  type PetState,
  PLAYBACK_MODES,
} from '../../contract/petState';
import type { StudioStrings } from '../../interact/studioStrings';
import type { StudioCatalogFile, StudioDraft } from './draft';

export function StateSlotGrid(props: {
  strings: StudioStrings;
  draft: StudioDraft;
  files: readonly StudioCatalogFile[];
  onSlotChange: (state: PetState, slot: StudioDraft['states'][PetState]) => void;
  onCopyIdle: () => void;
}) {
  const { strings, draft, files, onSlotChange, onCopyIdle } = props;
  const sheetNames = files.filter((f) => /\.(png|svg)$/i.test(f.name)).map((f) => f.name);
  return (
    <section data-testid="pet-manager-studio-slots">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{strings.slotsTitle}</h3>
        <button
          type="button"
          data-testid="pet-manager-studio-copy-idle"
          className="rounded-md border border-border/40 px-2 py-1 text-xs text-foreground hover:bg-surface-2"
          onClick={onCopyIdle}
        >
          {strings.copyFromIdle}
        </button>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="py-1 pr-2" />
              <th className="py-1 pr-2">{strings.colSheet}</th>
              <th className="py-1 pr-2">{strings.colFrames}</th>
              <th className="py-1 pr-2">{strings.colFps}</th>
              <th className="py-1 pr-2">{strings.colPlayback}</th>
              <th className="py-1 pr-2">{strings.colMotion}</th>
            </tr>
          </thead>
          <tbody>
            {PET_STATES.map((state) => (
              <SlotRow
                key={state}
                state={state}
                strings={strings}
                slot={draft.states[state]}
                sheetNames={sheetNames}
                onChange={(slot) => onSlotChange(state, slot)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SlotRow(props: {
  state: PetState;
  strings: StudioStrings;
  slot: StudioDraft['states'][PetState];
  sheetNames: readonly string[];
  onChange: (slot: StudioDraft['states'][PetState]) => void;
}) {
  const { state, strings, slot, sheetNames, onChange } = props;
  const motionAllowed = slot.frames === 1 || state === MOTION_ON_MULTI_FRAME_EXCEPTION;
  return (
    <tr data-testid={`pet-manager-studio-slot-${state}`}>
      <td className="py-1 pr-2 font-medium text-foreground">{state}</td>
      <td className="py-1 pr-2">
        <select
          data-testid={`pet-manager-studio-slot-${state}-sheet`}
          className="max-w-40 rounded-md border border-border/40 bg-surface-1 px-1 py-0.5 text-foreground"
          value={slot.sheet}
          onChange={(event) => onChange({ ...slot, sheet: event.target.value })}
        >
          <option value="">{strings.sheetEmpty}</option>
          {sheetNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </td>
      <td className="py-1 pr-2">
        <input
          type="number"
          min={1}
          max={64}
          data-testid={`pet-manager-studio-slot-${state}-frames`}
          className="w-16 rounded-md border border-border/40 bg-surface-1 px-1 py-0.5 text-foreground"
          value={slot.frames}
          onChange={(event) => onChange({ ...slot, frames: Number(event.target.value) })}
        />
      </td>
      <td className="py-1 pr-2">
        <input
          type="number"
          min={1}
          max={30}
          data-testid={`pet-manager-studio-slot-${state}-fps`}
          className="w-16 rounded-md border border-border/40 bg-surface-1 px-1 py-0.5 text-foreground"
          value={slot.fps}
          onChange={(event) => onChange({ ...slot, fps: Number(event.target.value) })}
        />
      </td>
      <td className="py-1 pr-2">
        <select
          data-testid={`pet-manager-studio-slot-${state}-playback`}
          className="rounded-md border border-border/40 bg-surface-1 px-1 py-0.5 text-foreground"
          value={slot.playback}
          onChange={(event) => onChange({ ...slot, playback: event.target.value as StudioDraft['states'][PetState]['playback'] })}
        >
          {PLAYBACK_MODES.map((mode) => {
            const gated = (mode === 'pingpong' || mode === 'blink') && slot.frames < 2;
            return (
              <option key={mode} value={mode} disabled={gated && mode !== slot.playback}>
                {mode}
              </option>
            );
          })}
        </select>
      </td>
      <td className="py-1 pr-2">
        <select
          data-testid={`pet-manager-studio-slot-${state}-motion`}
          className="rounded-md border border-border/40 bg-surface-1 px-1 py-0.5 text-foreground"
          value={slot.motion ?? ''}
          disabled={!motionAllowed}
          onChange={(event) =>
            onChange({ ...slot, motion: (event.target.value || null) as StudioDraft['states'][PetState]['motion'] })
          }
        >
          <option value="">—</option>
          {MOTION_RECIPES.map((recipe) => (
            <option key={recipe} value={recipe}>
              {recipe}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}
