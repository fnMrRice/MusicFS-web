import { orderRecommendationSources } from "../app/recommendation-order";
import { useServices, useStore } from "../app/services";
import { useSourceName } from "../components/use-source-name";
import { tr } from "../i18n";
import "./recommendation-order-settings.css";

export function RecommendationOrderSettings() {
  const s = useServices();
  const sources = useStore(s.content.onlineInstances);
  const { recommendationOrder } = useStore(s.preferences);
  const sourceName = useSourceName();
  const ordered = orderRecommendationSources(sources, recommendationOrder);
  function move(index: number, step: number) {
    const ids = ordered.map((source) => source.instanceId);
    const next = index + step;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    s.preference({ recommendationOrder: ids });
  }
  return <section className="settings-card recommendation-order-settings" aria-labelledby="recommendation-order-title">
    <h3 id="recommendation-order-title">{tr("推荐来源排序")}</h3>
    {ordered.length ? <ol>
      {ordered.map((source, index) => {
        const name = sourceName(source);
        const up = tr("上移 {name}", { name });
        const down = tr("下移 {name}", { name });
        return <li key={source.instanceId}><div className="recommendation-order-row">
          <span>{name}</span>
          <button type="button" aria-label={up} title={up} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={down} title={down} disabled={index === ordered.length - 1} onClick={() => move(index, 1)}>↓</button>
        </div></li>;
      })}
    </ol> : <p className="muted">{tr("暂无推荐来源。")}</p>}
  </section>;
}
