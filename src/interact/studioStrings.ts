/**
 * src/interact/studioStrings.ts — the Pack Studio's string table (D7:
 * `PageStrings` gains a `studio` sub-table; this file IS that sub-table, in
 * its own module only so `locale.ts` stays under the max-lines bucket — the
 * three-locale discipline is identical: no i18n keys, no host i18next, `en`
 * the fallback). Owned by the manager window like the rest of the page
 * body.
 */

/** The studio sub-table (D7.1–.6; `{dir}`/`{count}`/`{name}`/`{id}` interpolate). */
export interface StudioStrings {
  /** Manage-view entry button (opens the studio sub-view). */
  readonly openAction: string;
  /** Studio-view back button. */
  readonly backAction: string;
  /** The no-ipc degrade card (host without the pack API). */
  readonly unavailableTitle: string;
  readonly unavailableBody: string;
  /** Step 1 — source folder. */
  readonly sourceTitle: string;
  readonly pickSourceDir: string;
  readonly sourceDirCaption: string;
  /** Step 1b — the whale-girl auto-fill offer (D8). */
  readonly whaleGirlTitle: string;
  readonly whaleGirlFill: string;
  readonly whaleGirlRights: string;
  /** Step 2 — the 15-state slot grid. */
  readonly slotsTitle: string;
  readonly copyFromIdle: string;
  readonly colSheet: string;
  readonly colFrames: string;
  readonly colFps: string;
  readonly colPlayback: string;
  readonly colMotion: string;
  readonly sheetEmpty: string;
  /** Step 3 — meta form. */
  readonly metaTitle: string;
  readonly fieldId: string;
  readonly fieldName: string;
  readonly fieldCredit: string;
  readonly fieldLicense: string;
  /** Step 4 — preview + the live problem list. */
  readonly previewTitle: string;
  readonly problemsTitle: string;
  readonly problemsNone: string;
  /** Step 5 — save. */
  readonly saveAction: string;
  readonly overwriteAction: string;
  readonly savedNote: string;
  /** Step 6 — export. */
  readonly exportAction: string;
}

type Table = Record<'en' | 'zh' | 'ja', StudioStrings>;

const STUDIO_STRINGS: Table = {
  en: {
    openAction: 'Create a character pack…',
    backAction: 'Back',
    unavailableTitle: 'Pack Studio unavailable',
    unavailableBody:
      'This Elftia version does not expose the pack API. Update Elftia to author packs here.',
    sourceTitle: '1 · Source folder',
    pickSourceDir: 'Choose folder…',
    sourceDirCaption: '{dir} — {count} usable sheets',
    whaleGirlTitle: 'whale-girl manifest detected',
    whaleGirlFill: 'Auto-fill from {name}',
    whaleGirlRights: 'Confirm you own the rights to share this character art.',
    slotsTitle: '2 · States',
    copyFromIdle: 'Copy idle to unassigned states',
    colSheet: 'Sheet',
    colFrames: 'Frames',
    colFps: 'FPS',
    colPlayback: 'Playback',
    colMotion: 'Motion',
    sheetEmpty: '— unassigned —',
    metaTitle: '3 · Meta',
    fieldId: 'Pack id',
    fieldName: 'Display name',
    fieldCredit: 'Credit (artist)',
    fieldLicense: 'License',
    previewTitle: '4 · Preview',
    problemsTitle: 'Problems',
    problemsNone: 'No problems — the draft is valid.',
    saveAction: '5 · Save pack',
    overwriteAction: 'Overwrite existing pack',
    savedNote: 'Installed as "{id}".',
    exportAction: '6 · Export .petpack',
  },
  zh: {
    openAction: '制作角色包…',
    backAction: '返回',
    unavailableTitle: '角色包工作台不可用',
    unavailableBody: '当前 Elftia 版本未提供角色包接口，请更新 Elftia 后再在此制作角色包。',
    sourceTitle: '1 · 素材文件夹',
    pickSourceDir: '选择素材文件夹…',
    sourceDirCaption: '{dir} — {count} 个可用素材',
    whaleGirlTitle: '检测到 whale-girl 清单',
    whaleGirlFill: '从 {name} 自动填充',
    whaleGirlRights: '请确认你拥有该角色素材的分享权利。',
    slotsTitle: '2 · 状态',
    copyFromIdle: '把基础状态复制到未配置项',
    colSheet: '素材',
    colFrames: '帧数',
    colFps: '帧率',
    colPlayback: '播放',
    colMotion: '动作',
    sheetEmpty: '— 未配置 —',
    metaTitle: '3 · 元信息',
    fieldId: '包 id',
    fieldName: '显示名称',
    fieldCredit: '署名（画师）',
    fieldLicense: '许可',
    previewTitle: '4 · 预览',
    problemsTitle: '问题',
    problemsNone: '没有问题 — 草稿有效。',
    saveAction: '5 · 保存角色包',
    overwriteAction: '覆盖已有角色包',
    savedNote: '已安装为「{id}」。',
    exportAction: '6 · 导出 .petpack',
  },
  ja: {
    openAction: 'キャラクターパックを作る…',
    backAction: '戻る',
    unavailableTitle: 'パックスタジオは利用できません',
    unavailableBody:
      'この Elftia はパック API を提供していません。ここでパックを作るには Elftia を更新してください。',
    sourceTitle: '1 · 素材フォルダー',
    pickSourceDir: 'フォルダーを選択…',
    sourceDirCaption: '{dir} — 使用可能なシート {count} 枚',
    whaleGirlTitle: 'whale-girl マニフェストを検出',
    whaleGirlFill: '{name} から自動入力',
    whaleGirlRights: 'このキャラクター素材を共有する権利があることを確認してください。',
    slotsTitle: '2 · ステート',
    copyFromIdle: '未設定のステートに idle をコピー',
    colSheet: 'シート',
    colFrames: 'フレーム数',
    colFps: 'FPS',
    colPlayback: '再生',
    colMotion: 'モーション',
    sheetEmpty: '— 未設定 —',
    metaTitle: '3 · メタ情報',
    fieldId: 'パック id',
    fieldName: '表示名',
    fieldCredit: 'クレジット（絵師）',
    fieldLicense: 'ライセンス',
    previewTitle: '4 · プレビュー',
    problemsTitle: '問題',
    problemsNone: '問題なし — ドラフトは有効です。',
    saveAction: '5 · パックを保存',
    overwriteAction: '既存のパックを上書き',
    savedNote: '「{id}」としてインストールしました。',
    exportAction: '6 · .petpack をエクスポート',
  },
};

export function studioStrings(locale: 'en' | 'zh' | 'ja'): StudioStrings {
  return STUDIO_STRINGS[locale];
}
