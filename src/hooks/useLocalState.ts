import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { loadJson, saveJson } from '../lib/storage';

/** useState that survives reloads via localStorage. */
export function useLocalState<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => loadJson(key, fallback));
  useEffect(() => {
    saveJson(key, value);
  }, [key, value]);
  return [value, setValue];
}
