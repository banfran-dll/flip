import { useEffect, useState, type InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number;
  onChange: (n: number) => void;
  /** Parse the draft text; return null to keep the previous committed value. */
  parse?: (s: string) => number | null;
  format?: (n: number) => string;
}

/** Numeric input that keeps a free-text draft while focused and commits valid numbers as you type. */
export function NumField({ value, onChange, parse = defaultParse, format = String, ...rest }: Props) {
  const [draft, setDraft] = useState(() => format(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  return (
    <input
      {...rest}
      inputMode="decimal"
      value={draft}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setDraft(format(value));
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parse(e.target.value);
        if (n != null && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function defaultParse(s: string): number | null {
  const trimmed = s.trim().replace(/,/g, '');
  if (trimmed === '' || trimmed === '-' || trimmed === '.') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
