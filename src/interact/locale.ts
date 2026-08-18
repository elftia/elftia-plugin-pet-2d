/**
 * src/interact/locale.ts — OQ7: the pet's own three-language string table,
 * resolved from `navigator.language`. NO i18n keys, NO `host.i18n`
 * dependency — the pet window renders before (and independently of) any
 * host locale plumbing, and a desktop pet that speaks the host's UI
 * language only when the host hands it a table is a pet that goes mute on
 * every host refactor. `en` is the fallback for every unrecognized tag.
 */

/** The three languages this plugin ships strings for. */
export type PetLocale = 'en' | 'zh' | 'ja';

/** The context menu's four verbs (D12) + its accessible label. */
export interface MenuStrings {
  readonly menuLabel: string;
  readonly feed: string;
  readonly play: string;
  readonly switchCharacter: string;
  readonly exitApp: string;
}

const STRINGS: Record<PetLocale, MenuStrings> = {
  en: {
    menuLabel: 'Pet menu',
    feed: 'Feed',
    play: 'Play',
    switchCharacter: 'Switch character',
    exitApp: 'Exit Elftia',
  },
  zh: {
    menuLabel: '桌宠菜单',
    feed: '喂食',
    play: '玩耍',
    switchCharacter: '换角色',
    exitApp: '退出 Elftia',
  },
  ja: {
    menuLabel: 'ペットメニュー',
    feed: '餌やり',
    play: '遊ぶ',
    switchCharacter: 'キャラ変更',
    exitApp: 'Elftia を終了',
  },
};

/**
 * Maps a BCP-47 tag (`navigator.language`) to the table's locale. Primary
 * subtag match, case-insensitive — `zh-TW`/`zh-Hans` → `zh`; anything
 * unrecognized → `en`. Explicitly NOT exact-match: hosts report regional
 * tags constantly and a pet that flips to English for `ja-JP` reads broken.
 */
export function resolveLocale(language: string): PetLocale {
  const primary = language.trim().toLowerCase().split('-')[0];
  if (primary === 'zh') return 'zh';
  if (primary === 'ja') return 'ja';
  return 'en';
}

export function menuStrings(locale: PetLocale): MenuStrings {
  return STRINGS[locale];
}
