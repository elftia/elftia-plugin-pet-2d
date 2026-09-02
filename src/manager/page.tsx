/**
 * src/manager/page.tsx — the ManagerPage body (desktop-pet-manager-page
 * D6's anatomy). A code-registered agent page's body mounts inside the
 * host's MainContent tree, so the HOST's compiled Tailwind CSS is the only
 * stylesheet in play: this file deliberately restricts itself to class
 * names the host itself uses pervasively (flex, gap, padding, rounded-xl,
 * bg-surface, text-foreground, text-muted-foreground, border-border — the
 * DS precedent). A plugin-only exotic class would silently generate no CSS.
 *
 * Group 5: the header consumes the config hook (petId chip +
 * presence-hidden badge, D6①); master controls + the off banner are
 * MasterControls.tsx. The gallery (group 6) and ledger panel (group 8)
 * keep their section roots here as stable testid anchors.
 *
 * React arrives through the host import map (bare specifier, external in
 * vite.plugin.manager.config.ts); strings come from the plugin's own locale
 * table (D7 — no host i18n keys). INTERACTIVE elements are created through
 * `./hostedElements` (the host's patched createElement) so the remote-DOM
 * serializer opts them into event forwarding — see that module's header.
 *
 * Group 6: the page is a two-view switch — `manage` (the D6 anatomy below)
 * and `studio` (the Pack Studio sub-view; entry button in the gallery
 * header). The studio replaces the sections, not the header, so the pet-id
 * chip and locale stay put while the author works.
 */
import { useState } from 'react';

import { pageStrings, resolvePageLocale } from '../interact/locale';
import { Gallery } from './Gallery';
import { getManagerHostOrNull } from './hostBridge';
import { HostedButton } from './hostedElements';
import { LedgerPanel } from './LedgerPanel';
import { MasterControls, OffBanner } from './MasterControls';
import { Studio } from './studio/Studio';
import { usePetConfig } from './usePetConfig';

export function ManagerPage() {
  const strings = pageStrings(resolvePageLocale());
  const cfg = usePetConfig();
  const [view, setView] = useState<'manage' | 'studio'>('manage');

  return (
    <div data-testid="pet-manager-page" className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
        {/* Section 1 — header: title + the resolved pet id + presence badge (D6①). */}
        <header
          data-testid="pet-manager-header"
          className="flex items-center gap-3 border-b border-border/30 pb-4 dark:border-border/50"
        >
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            {strings.pageTitle}
          </h1>
          {cfg.status === 'ready' && cfg.config?.petId ? (
            <span
              data-testid="pet-manager-pet-id"
              className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-text-muted"
            >
              {cfg.config.petId}
            </span>
          ) : null}
          {cfg.status === 'ready' && cfg.config?.presenceHidden === true ? (
            <span
              data-testid="pet-manager-presence-hidden-badge"
              className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-text-muted"
            >
              {strings.presenceHiddenBadge}
            </span>
          ) : null}
        </header>

        {view === 'studio' ? (
          <Studio strings={strings} ipc={getManagerHostOrNull()?.ipc ?? null} onExit={() => setView('manage')} />
        ) : (
          <>
            {/* Section 2 — master controls (D6②): enabled + opaque-fallback
                switches, the update-required degradation, the unresolved row. */}
            <MasterControls strings={strings} cfg={cfg} />

            {/* Section 3 — the pet-off banner (D6③): only when !enabled. */}
            <OffBanner strings={strings} cfg={cfg} />

            {/* Section 4 — character gallery (D6④): pack cards with live
                idle-sheet previews (group 6) + the Pack Studio entry (D7). */}
            <section
              data-testid="pet-manager-gallery"
              className="rounded-xl border border-border/30 bg-surface-1/80 p-4 dark:border-border/50"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{strings.galleryTitle}</h2>
                <HostedButton
                  type="button"
                  data-testid="pet-manager-studio-open"
                  className="rounded-md border border-border/40 px-2 py-1 text-xs text-foreground hover:bg-surface-2"
                  onClick={() => setView('studio')}
                >
                  {strings.studio.openAction}
                </HostedButton>
              </div>
              <Gallery strings={strings} />
            </section>

            {/* Section 5 — ledger panel (D6⑤): behind the guarded dynamic-import
                seam; renders the honest unavailable card when trimmed (group 8). */}
            <section
              data-testid="pet-manager-ledger"
              className="rounded-xl border border-border/30 bg-surface-1/80 p-4 dark:border-border/50"
            >
              <h2 className="mb-2 text-sm font-semibold text-foreground">{strings.ledgerTitle}</h2>
              <LedgerPanel strings={strings} />
            </section>

            {/* Section 6 — footer: the honest limits one-liner (D6⑥). */}
            <footer
              data-testid="pet-manager-footer"
              className="border-t border-border/20 pt-3 text-xs text-text-muted dark:border-border/40"
            >
              {strings.footerNote}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
