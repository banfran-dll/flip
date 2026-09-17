import type { T } from '../hooks/useT';
import { integer, parseCoins } from '../lib/format';
import { DEFAULT_SETTINGS, TAX_PRESETS, type AppSettings } from '../settings';
import { NumField } from './NumField';

interface Props {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  t: T;
}

export function SettingsPanel({ settings, onChange, t }: Props) {
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });
  const presetKey = TAX_PRESETS.find((p) => Math.abs(p.rate - settings.taxRate) < 1e-9)?.key ?? 'taxCustom';

  return (
    <div className="settings">
      <section className="settings__group">
        <label className="field">
          <span className="field__label">{t('budget')}</span>
          <NumField
            className="input"
            value={settings.budget}
            onChange={(n) => set('budget', Math.max(0, n))}
            parse={parseCoins}
            format={integer}
          />
          <span className="field__hint">{t('budgetHint')}</span>
        </label>

        <div className="field">
          <span className="field__label">{t('taxRate')}</span>
          <div className="radios">
            {TAX_PRESETS.map((p) => (
              <label key={p.key} className="radio">
                <input type="radio" name="tax" checked={presetKey === p.key} onChange={() => set('taxRate', p.rate)} />
                <span>{t(p.key)}</span>
              </label>
            ))}
            <label className="radio">
              <input type="radio" name="tax" checked={presetKey === 'taxCustom'} onChange={() => set('taxRate', settings.taxRate)} />
              <span>{t('taxCustom')}</span>
              <NumField
                className="input input--tiny"
                value={Math.round(settings.taxRate * 100000) / 1000}
                onChange={(n) => set('taxRate', Math.max(0, n) / 100)}
                aria-label={t('taxCustom')}
              />
            </label>
          </div>
        </div>

        <label className="field">
          <span className="field__label">{t('minCycle')}</span>
          <NumField className="input" value={settings.minCycleMinutes} onChange={(n) => set('minCycleMinutes', Math.max(0, n))} />
          <span className="field__hint">{t('minCycleHint')}</span>
        </label>
      </section>

      <section className="settings__group">
        <h3 className="settings__heading">{t('filters')}</h3>
        <label className="field">
          <span className="field__label">{t('minWeeklyVolume')}</span>
          <NumField className="input" value={settings.minWeeklyVolume} onChange={(n) => set('minWeeklyVolume', Math.max(0, n))} parse={parseCoins} format={integer} />
          <span className="field__hint">{t('minWeeklyVolumeHint')}</span>
        </label>
        <label className="field">
          <span className="field__label">{t('minMargin')}</span>
          <NumField className="input" value={settings.minMarginPct} onChange={(n) => set('minMarginPct', n)} />
        </label>
        <label className="field">
          <span className="field__label">{t('minProfitUnit')}</span>
          <NumField className="input" value={settings.minProfitPerUnit} onChange={(n) => set('minProfitPerUnit', n)} parse={parseCoins} format={integer} />
        </label>
        <div className="field">
          <span className="field__label">{t('priceRange')}</span>
          <div className="field__row">
            <NumField className="input" value={settings.minPrice} onChange={(n) => set('minPrice', Math.max(0, n))} parse={parseCoins} format={integer} placeholder={t('priceMin')} aria-label={t('priceMin')} />
            <span className="muted">~</span>
            <NumField className="input" value={settings.maxPrice} onChange={(n) => set('maxPrice', Math.max(0, n))} parse={parseCoins} format={integer} placeholder={t('priceMax')} aria-label={t('priceMax')} />
          </div>
          <span className="field__hint">{t('priceMax')}</span>
        </div>
        <label className="field">
          <span className="field__label">{t('hideFlags')}</span>
          <select className="input" value={settings.hideFlags} onChange={(e) => set('hideFlags', e.target.value as AppSettings['hideFlags'])}>
            <option value="danger">{t('hideFlagsDanger')}</option>
            <option value="all">{t('hideFlagsAll')}</option>
            <option value="none">{t('hideFlagsNone')}</option>
          </select>
          <span className="field__hint">{t('hideFlagsHint')}</span>
        </label>
      </section>

      <section className="settings__group">
        <label className="field">
          <span className="field__label">{t('refreshMode')}</span>
          <select className="input" value={settings.refreshMode} onChange={(e) => set('refreshMode', e.target.value as AppSettings['refreshMode'])}>
            <option value="live">{t('refreshModeLive')}</option>
            <option value="interval">{t('refreshModeInterval')}</option>
          </select>
          <span className="field__hint">{t('refreshModeHint')}</span>
        </label>
        {settings.refreshMode === 'interval' && (
          <label className="field">
            <span className="field__label">{t('refreshInterval')}</span>
            <NumField className="input" value={settings.refreshSec} onChange={(n) => set('refreshSec', Math.max(5, Math.round(n)))} />
          </label>
        )}
        <button type="button" className="btn btn--ghost" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>
          {t('reset')}
        </button>
      </section>
    </div>
  );
}
