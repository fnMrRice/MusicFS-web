import { useId, type CSSProperties } from 'react';
import { tr } from '../../i18n';
import type { LocalDSPNode } from '../../player/dsp/model';
import { graphicEqualizerBands, graphicEqualizerPresets } from '../../player/dsp/graphic-equalizer';
import './graphic-equalizer.css';

export interface Props {
  node: LocalDSPNode;
  change(node: LocalDSPNode): void;
}

function gain(value: number): string {
  return `${value > 0 ? '+' : ''}${value} dB`;
}

export function GraphicEqualizerEditor({ node, change }: Props) {
  const id = useId();
  const selected = graphicEqualizerPresets.find((preset) =>
    Object.entries(preset.params).every(([key, value]) => (node.params[key] ?? 0) === value));
  const setParameter = (key: string, value: number) => change({ ...node, params: { ...node.params, [key]: value } });
  const applyPreset = (presetId: string) => {
    const preset = graphicEqualizerPresets.find((item) => item.id === presetId);
    if (preset) change({ ...node, params: { ...preset.params } });
  };

  return <section className="graphic-equalizer" aria-label={tr('十段均衡器')}>
    <div className="graphic-equalizer-toolbar">
      <label htmlFor={`${id}-preset`}>
        <span>{tr('均衡器预设')}</span>
        <select id={`${id}-preset`} aria-label={tr('均衡器预设')} value={selected?.id ?? 'custom'} onChange={(event) => applyPreset(event.target.value)}>
          {graphicEqualizerPresets.map((preset) => <option key={preset.id} value={preset.id}>{tr(preset.name)}</option>)}
          {!selected && <option value="custom" disabled>{tr('自定义')}</option>}
        </select>
      </label>
      <button type="button" onClick={() => applyPreset('flat')}>{tr('重置均衡器')}</button>
    </div>

    <div className="graphic-equalizer-scroll">
      <div className="graphic-equalizer-chart">
        <div className="graphic-equalizer-scale" aria-hidden="true">
          <span>+12 dB</span><span>0 dB</span><span>−12 dB</span>
        </div>
        <div className="graphic-equalizer-bands">
          {graphicEqualizerBands.map((band) => {
            const value = node.params[band.key] ?? 0;
            const controlId = `${id}-${band.key}`;
            const style = { '--eq-level': `${(value + 12) / 24 * 100}%` } as CSSProperties;
            return <div className="graphic-equalizer-band" key={band.key}>
              <output htmlFor={controlId}>{gain(value)}</output>
              <div className="graphic-equalizer-fader" style={style}>
                <div className="graphic-equalizer-rail" aria-hidden="true"><span className="graphic-equalizer-fill" /><span className="graphic-equalizer-thumb" /></div>
                <input id={controlId} type="range" min={-12} max={12} step={0.5} value={value}
                  aria-label={tr('调节 {frequency} Hz', { frequency: band.frequency })} aria-orientation="vertical" aria-valuetext={gain(value)}
                  onChange={(event) => setParameter(band.key, Number(event.target.value))} />
              </div>
              <label htmlFor={controlId}>{band.label}</label>
            </div>;
          })}
        </div>
      </div>
    </div>

    <div className="graphic-equalizer-enhancements">
      {[
        { key: 'bassGain', name: '低音增强', description: '增强低频的厚度与力度。' },
        { key: 'trebleGain', name: '高音增强', description: '增强高频的明亮感与细节。' },
      ].map((control) => {
        const value = node.params[control.key] ?? 0;
        const controlId = `${id}-${control.key}`;
        return <div className="graphic-equalizer-enhancement" key={control.key}>
          <div className="graphic-equalizer-enhancement-heading"><label htmlFor={controlId}>{tr(control.name)}</label><output htmlFor={controlId}>{gain(value)}</output></div>
          <input id={controlId} type="range" min={0} max={12} step={0.5} value={value}
            aria-label={tr('{name}（dB）', { name: tr(control.name) })} aria-valuetext={gain(value)}
            onChange={(event) => setParameter(control.key, Number(event.target.value))} />
          <p>{tr(control.description)}</p>
        </div>;
      })}
    </div>
  </section>;
}
