/**
 * src/manager/studio/MetaForm.tsx — step 3 of the six-step flow (D7.3):
 * the four identity fields. The id input is the only one with a live
 * pattern gate (the contract's `^[a-z0-9][a-z0-9-]{0,31}$` shows up in the
 * problems list the moment it breaks — this component stays presentational;
 * `draft.ts` + `validateCharacterPack` own the rule).
 */
import type { StudioDraft } from './draft';

export type MetaField = 'id' | 'name' | 'credit' | 'license';

export function MetaForm(props: {
  strings: { metaTitle: string; fieldId: string; fieldName: string; fieldCredit: string; fieldLicense: string };
  draft: StudioDraft;
  onChange: (patch: Partial<Pick<StudioDraft, MetaField>>) => void;
}) {
  const { strings, draft, onChange } = props;
  const fields: ReadonlyArray<{ field: MetaField; label: string }> = [
    { field: 'id', label: strings.fieldId },
    { field: 'name', label: strings.fieldName },
    { field: 'credit', label: strings.fieldCredit },
    { field: 'license', label: strings.fieldLicense },
  ];
  return (
    <section data-testid="pet-manager-studio-meta">
      <h3 className="text-sm font-semibold text-foreground">{strings.metaTitle}</h3>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {fields.map(({ field, label }) => (
          <label key={field} className="flex flex-col gap-1 text-xs text-text-muted">
            {label}
            <input
              type="text"
              data-testid={`pet-manager-studio-meta-${field}`}
              className="rounded-md border border-border/40 bg-surface-1 px-2 py-1 text-sm text-foreground"
              value={draft[field]}
              onChange={(event) => onChange({ [field]: event.target.value } as Partial<Pick<StudioDraft, MetaField>>)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
