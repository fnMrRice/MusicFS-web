import { useId, type ReactNode } from "react";
import { useServices, useStore } from "../app/services";
import { Icon } from "../components/ui";

interface Props {
  sourceId?: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function RecommendationSection({ sourceId, title, actions, children }: Props) {
  const s = useServices();
  const preferences = useStore(s.preferences);
  const bodyId = useId();
  const isSource = sourceId !== undefined;
  const key = isSource ? `source:${sourceId}` : "all";
  const expanded = !preferences.collapsedRecommendations.includes(key);
  const Heading = isSource ? "h3" : "h2";

  function toggle() {
    const collapsed = s.preferences.value.collapsedRecommendations;
    const next = collapsed.includes(key) ? collapsed.filter(item => item !== key) : [...collapsed, key];
    s.preference({ collapsedRecommendations: next });
  }

  return <section className={isSource ? "source-section" : undefined}>
    <div className={isSource ? "section-title" : "section-title recommendation-heading"}>
      <Heading>
        <button type="button" className="recommendation-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={toggle}>
          <Icon name="chevron" size={14} /><span>{title}</span>
        </button>
      </Heading>
      {actions}
    </div>
    <div id={bodyId} hidden={!expanded}>{expanded && children}</div>
  </section>;
}
