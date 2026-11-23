import { useId, type ReactNode } from "react";
import { useServices, useStore } from "../app/services";
import { SectionToggle } from "../components/ui";

interface Props {
  sourceId: string;
  title: string;
  children: ReactNode;
}

export function RecommendationSection({ sourceId, title, children }: Props) {
  const s = useServices();
  const preferences = useStore(s.preferences);
  const bodyId = useId();
  const key = `source:${sourceId}`;
  const expanded = !preferences.collapsedRecommendations.includes(key);

  function toggle() {
    const collapsed = s.preferences.value.collapsedRecommendations;
    const next = collapsed.includes(key) ? collapsed.filter(item => item !== key) : [...collapsed, key];
    s.preference({ collapsedRecommendations: next });
  }

  return <section className="source-section">
    <div className="section-title">
      <h3>
        <SectionToggle title={title} expanded={expanded} controls={bodyId} onClick={toggle} />
      </h3>
    </div>
    <div id={bodyId} hidden={!expanded}>{expanded && children}</div>
  </section>;
}
