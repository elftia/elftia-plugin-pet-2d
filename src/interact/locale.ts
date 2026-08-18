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

// ─── The manager page (desktop-pet-manager-page D6/D7) ─────────────────────
//
// The page body runs in the MAIN window, but keeps the same plugin-owned
// string discipline (OQ7): no i18n keys, no host i18next. Resolution is
// app-locale-first (D7): the persisted host locale in localStorage['locale']
// wins, else navigator.language's primary subtag, else 'en' — the DS
// `resolveDesignStudioLabel` pattern extended to the whole body.

/** The manager page's strings (D6's sections; en is the fallback). */
export interface PageStrings {
  /** Header title — also the rail label at register time. */
  readonly pageTitle: string;
  /** Header badge when `getConfig().presenceHidden` is true. */
  readonly presenceHiddenBadge: string;
  /** Section 2 — master controls. */
  readonly masterControlsTitle: string;
  readonly enabledSwitchLabel: string;
  readonly enabledSwitchHint: string;
  readonly opaqueFallbackSwitchLabel: string;
  readonly opaqueFallbackSwitchHint: string;
  /** Section 2 degradation when `setConfig` is absent (host < 1.53). */
  readonly needsUpdateTitle: string;
  readonly needsUpdateBody: string;
  /** Section 2's unresolved-contributor row (D3). */
  readonly unresolvedRowText: string;
  readonly rescanButton: string;
  readonly multiContributorHint: string;
  /** Section 3 — the pet-off banner. */
  readonly offBanner: string;
  readonly enableButton: string;
  /** Section 4 — character gallery. */
  readonly galleryTitle: string;
  /** Pack-card caption: `{count}` replaced with the contract state count. */
  readonly cardStatesCaption: string;
  /** Badge on the currently-selected pack card. */
  readonly cardSelectedBadge: string;
  /** Section 5 — ledger panel. */
  readonly ledgerTitle: string;
  readonly ledgerUnavailableTitle: string;
  readonly ledgerUnavailableBody: string;
  /** Prefix before the numeric level, e.g. "Level 3". */
  readonly ledgerLevelLabel: string;
  /** Shown in place of a title before the first unlock. */
  readonly ledgerNoTitle: string;
  /** Stats-row labels (values are raw counters / preformatted durations). */
  readonly ledgerStatTasks: string;
  readonly ledgerStatFailures: string;
  readonly ledgerStatTurns: string;
  readonly ledgerStatMediaJobs: string;
  readonly ledgerStatActive: string;
  /** The memory ring list. */
  readonly ledgerMemoryTitle: string;
  readonly ledgerMemoryEmpty: string;
  /** Section 6 — footer. */
  readonly footerNote: string;
  /** Skeleton placeholder (tasks 4.2) — honest copy inside empty shells. */
  readonly sectionPlaceholder: string;
}

const PAGE_STRINGS: Record<PetLocale, PageStrings> = {
  en: {
    pageTitle: 'Desktop Pet',
    presenceHiddenBadge: 'Hidden',
    masterControlsTitle: 'Master controls',
    enabledSwitchLabel: 'Enable desktop pet',
    enabledSwitchHint: 'Turning this off removes the pet from the desktop',
    opaqueFallbackSwitchLabel: 'Opaque fallback window',
    opaqueFallbackSwitchHint: 'Show the pet window opaque when transparency is unavailable',
    needsUpdateTitle: 'Elftia update required',
    needsUpdateBody:
      'This Elftia version does not expose the pet management API. Update Elftia to use the switches on this page.',
    unresolvedRowText:
      'No pet contributor resolved — a freshly installed pet appears after a rescan',
    rescanButton: 'Rescan',
    multiContributorHint: 'Multiple pet contributors detected — choose the default pet in Settings',
    offBanner: 'Pet is off — enable to put the character on your desktop',
    enableButton: 'Enable',
    galleryTitle: 'Character gallery',
    ledgerTitle: 'Growth ledger',
    ledgerUnavailableTitle: 'Growth ledger unavailable (trimmed)',
    ledgerUnavailableBody:
      'This build ships without the ledger module — growth is neither recorded nor shown in this build; the pet itself is unaffected.',
    ledgerLevelLabel: 'Level',
    ledgerNoTitle: 'No title yet',
    ledgerStatTasks: 'Tasks',
    ledgerStatFailures: 'Failures',
    ledgerStatTurns: 'Turns',
    ledgerStatMediaJobs: 'Media jobs',
    ledgerStatActive: 'Companion time',
    ledgerMemoryTitle: 'Memory',
    ledgerMemoryEmpty: 'No memories yet',
    footerNote: 'The pet\'s host-activity coverage has gaps — see the plugin README.',
    sectionPlaceholder: 'This section fills in as the page is built out.',
    cardStatesCaption: '{count} states',
    cardSelectedBadge: 'Current',
  },
  zh: {
    pageTitle: '桌面宠物',
    presenceHiddenBadge: '已隐藏',
    masterControlsTitle: '主控开关',
    enabledSwitchLabel: '启用桌面宠物',
    enabledSwitchHint: '关闭后桌宠角色将从桌面消失',
    opaqueFallbackSwitchLabel: '不透明回退窗口',
    opaqueFallbackSwitchHint: '透明窗口不可用时以不透明模式显示',
    needsUpdateTitle: '需要更新 Elftia',
    needsUpdateBody: '当前 Elftia 版本不提供桌宠管理接口，请更新 Elftia 后使用此页的开关。',
    unresolvedRowText: '未解析到宠物贡献者 — 重新扫描后已安装的宠物会出现在这里',
    rescanButton: '重新扫描',
    multiContributorHint: '检测到多个宠物贡献者，请在设置中选择默认宠物',
    offBanner: '宠物已关闭 — 开启后角色将出现在桌面',
    enableButton: '开启',
    galleryTitle: '角色画廊',
    ledgerTitle: '成长账本',
    ledgerUnavailableTitle: '成长账本不可用（已被裁剪）',
    ledgerUnavailableBody: '此构建未携带账本模块 — 成长不会被记录，此页也无法显示；宠物本身不受影响。',
    ledgerLevelLabel: '等级',
    ledgerNoTitle: '还没有称号',
    ledgerStatTasks: '任务',
    ledgerStatFailures: '失败',
    ledgerStatTurns: '回合',
    ledgerStatMediaJobs: '媒体任务',
    ledgerStatActive: '陪伴时长',
    ledgerMemoryTitle: '记忆',
    ledgerMemoryEmpty: '还没有记忆',
    footerNote: '桌宠感知的宿主动作存在覆盖缺口，详见插件 README。',
    sectionPlaceholder: '此区块将在后续步骤填充。',
    cardStatesCaption: '{count} 状态',
    cardSelectedBadge: '当前',
  },
  ja: {
    pageTitle: 'デスクトップペット',
    presenceHiddenBadge: '非表示',
    masterControlsTitle: 'メインスイッチ',
    enabledSwitchLabel: 'デスクトップペットを有効化',
    enabledSwitchHint: 'オフにするとデスクトップからキャラクターが消えます',
    opaqueFallbackSwitchLabel: '不透明フォールバックウィンドウ',
    opaqueFallbackSwitchHint: '透明ウィンドウが使えない環境で不透明表示にします',
    needsUpdateTitle: 'Elftia の更新が必要',
    needsUpdateBody:
      'この Elftia はペット管理 API を提供していません。このページのスイッチを使用するには Elftia を更新してください。',
    unresolvedRowText: 'ペットコントリビューターが見つかりません — 再スキャンでインストール済みペットが表示されます',
    rescanButton: '再スキャン',
    multiContributorHint: '複数のペットコントリビューターを検出 — 設定で既定のペットを選択してください',
    offBanner: 'ペットはオフです — 有効化するとキャラクターがデスクトップに現れます',
    enableButton: '有効化',
    galleryTitle: 'キャラクターギャラリー',
    ledgerTitle: '成長レジャー',
    ledgerUnavailableTitle: '成長レジャーは利用できません（トリム済み）',
    ledgerUnavailableBody: 'このビルドにはレジャーモジュールが含まれません — 成長は記録されず、このページにも表示されません。ペット自体には影響しません。',
    ledgerLevelLabel: 'レベル',
    ledgerNoTitle: '称号はまだありません',
    ledgerStatTasks: 'タスク',
    ledgerStatFailures: '失敗',
    ledgerStatTurns: 'ターン',
    ledgerStatMediaJobs: 'メディア処理',
    ledgerStatActive: '同伴時間',
    ledgerMemoryTitle: 'メモリー',
    ledgerMemoryEmpty: 'メモリーはまだありません',
    footerNote: 'ホスト活動の検知には抜けがあります — 詳細はプラグイン README を参照。',
    sectionPlaceholder: 'このセクションは今後のステップで埋まります。',
    cardStatesCaption: '{count} 状態',
    cardSelectedBadge: '現在',
  },
};

export function pageStrings(locale: PetLocale): PageStrings {
  return PAGE_STRINGS[locale];
}

/**
 * The manager page's locale (D7): the persisted host locale
 * (`localStorage['locale']`, exact `en|zh|ja` only) wins, else
 * `navigator.language`'s primary subtag (via {@link resolveLocale}), else
 * `en`. Called at register time for the rail label and per mount for the
 * body — a locale switch is picked up on the next page open, not live (the
 * documented DS OQ1 deferral).
 */
export function resolvePageLocale(): PetLocale {
  try {
    const stored =
      typeof window !== 'undefined' ? window.localStorage?.getItem('locale') : null;
    if (stored === 'en' || stored === 'zh' || stored === 'ja') return stored;
  } catch {
    /* storage errors degrade to the navigator path */
  }
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    return resolveLocale(navigator.language);
  }
  return 'en';
}
