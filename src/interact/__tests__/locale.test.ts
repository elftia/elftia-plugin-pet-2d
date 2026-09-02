/**
 * src/interact/__tests__/locale.test.ts — task 7.2 (OQ7): navigator.language
 * → one of en/zh/ja, no i18n keys, no host.i18n. The zh strings are pinned
 * VERBATIM from design.md D12 (喂食 / 玩耍 / 换角色 / 退出 Elftia).
 */
import { describe, expect, it } from 'vitest';

import { menuStrings, type PetLocale, resolveLocale } from '../locale';

describe('resolveLocale', () => {
  it('primary-subtag match, case-insensitive', () => {
    expect(resolveLocale('zh')).toBe('zh');
    expect(resolveLocale('zh-TW')).toBe('zh');
    expect(resolveLocale('zh-Hans-CN')).toBe('zh');
    expect(resolveLocale('JA-jp')).toBe('ja');
    expect(resolveLocale('ja-JP')).toBe('ja');
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('EN')).toBe('en');
  });

  it('everything unrecognized falls back to en, never a throw', () => {
    expect(resolveLocale('fr-FR')).toBe('en');
    expect(resolveLocale('')).toBe('en');
    expect(resolveLocale('  ja  ')).toBe('ja'); // trimmed
  });
});

describe('menuStrings', () => {
  it('zh matches design.md D12 verbatim (+ the Quick Chat launcher strings)', () => {
    expect(menuStrings('zh')).toEqual({
      menuLabel: '桌宠菜单',
      feed: '喂食',
      play: '玩耍',
      switchCharacter: '换角色',
      exitApp: '退出 Elftia',
      quickChat: '快捷聊天',
      quickChatUnavailable: '快捷聊天暂时不可用',
    });
  });

  it('every locale carries the same seven keys, non-empty', () => {
    const locales: PetLocale[] = ['en', 'zh', 'ja'];
    const keySets = locales.map((locale) => Object.keys(menuStrings(locale)).sort());
    expect(keySets[0]).toEqual([
      'exitApp',
      'feed',
      'menuLabel',
      'play',
      'quickChat',
      'quickChatUnavailable',
      'switchCharacter',
    ]);
    for (const locale of locales) {
      for (const value of Object.values(menuStrings(locale))) {
        expect(value.length).toBeGreaterThan(0);
      }
    }
    expect(new Set(keySets.map((keys) => keys.join(','))).size).toBe(1);
  });
});
