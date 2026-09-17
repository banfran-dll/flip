import { useCallback } from 'react';
import { translate, type Key, type Lang } from '../i18n';

export type T = (key: Key, vars?: Record<string, string | number>) => string;

export function useT(lang: Lang): T {
  return useCallback<T>((key, vars) => translate(lang, key, vars), [lang]);
}
