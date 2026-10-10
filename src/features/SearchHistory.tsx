import { useEffect, useState } from 'react';
import { useServices, useStore } from '../app/services';
import { IconButton } from '../components/ui';

export function SearchHistory({ query, choose }: { query: string; choose: (query: string) => void }) {
  const s = useServices(); const auth = useStore(s.auth);
  const key = `musicfs:${encodeURIComponent(auth.ready!.instanceId)}:${encodeURIComponent(auth.session!.user.id)}:search-history`;
  const [items, setItems] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter((q): q is string => typeof q === 'string' && q.length <= 256).slice(0, 12) : []; }
    catch { return []; }
  });
  useEffect(() => {
    if (query) setItems(previous => [query, ...previous.filter(q => q !== query)].slice(0, 12));
  }, [query]);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* History remains in memory. */ } }, [items, key]);
  if (query || !items.length) return null;
  return <section aria-label="最近搜索"><div className="section-title"><h3>最近搜索</h3><button className="text-button" onClick={() => setItems([])}>清空记录</button></div><p className="muted">仅保存在此浏览器，按账号隔离。</p><div className="search-history">{items.map(q => <span key={q}><button onClick={() => choose(q)}>{q}</button><IconButton icon="close" label={`删除搜索记录 ${q}`} onClick={() => setItems(previous => previous.filter(value => value !== q))}/></span>)}</div></section>;
}
