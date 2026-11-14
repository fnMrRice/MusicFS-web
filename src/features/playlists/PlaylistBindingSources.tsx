import { useState } from "react";
import type { Binding } from "../../api/content";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { PlaylistSourceSelect } from "./PlaylistSourceSelect";
import { loadTrackMap } from "./playlist-tracks";

type Entries = NonNullable<Binding["entries"]>;
export function PlaylistBindingSources({ entries, change }: { entries: Entries; change: (entries: Entries) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!entries.some((row) => row.source.trackId)) return null;
  return <div>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{tr("编辑曲目来源")}</button>
    {expanded && <BindingTracks entries={entries} change={change} />}
  </div>;
}
function BindingTracks({ entries, change }: { entries: Entries; change: (entries: Entries) => void }) {
  const s = useServices();
  const ids = [...new Set(entries.flatMap((e) => e.source.trackId ? [e.source.trackId] : []))];
  const result = useResource(JSON.stringify(ids), (signal) => loadTrackMap(ids, signal, (id) => s.musicCatalog.track(id, signal)));
  return <>
    <ErrorNotice error={result.error} retry={result.reload} />
    {entries.map(({ source, entryId }, index) => {
      const track = result.data?.get(source.trackId ?? "");
      return track && <PlaylistSourceSelect key={entryId ?? index} track={track} value={source.forcedSourceTrackId ?? ""}
        change={(id) => change(entries.map((entry, i) => i === index
          ? { ...entry, source: { ...entry.source, forcedSourceTrackId: id || null } } : entry))} />;
    })}
  </>;
}
