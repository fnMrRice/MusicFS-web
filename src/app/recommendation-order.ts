export interface RecommendationLayout {
  recommendationOrder: string[];
  collapsedRecommendations: string[];
}

export function orderRecommendationSources<T extends { instanceId: string }>(sources: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  // 稳定排序让尚未设置顺序的新来源排在末尾，并保留它们在服务端的相对顺序。
  return [...sources].sort((a, b) => (rank.get(a.instanceId) ?? order.length) - (rank.get(b.instanceId) ?? order.length));
}

// localStorage 已按站点隔离，使用登录用户标识可在服务重启后继续使用同一份偏好。
function storageKey(user: string, field: keyof RecommendationLayout) {
  return `musicfs:recommendations:${encodeURIComponent(user)}:${field}`;
}

function readIds(user: string, field: keyof RecommendationLayout): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(storageKey(user, field)) ?? "[]");
    if (Array.isArray(ids)) return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  } catch { /* 浏览器存储不可用时使用默认布局。 */ }
  return [];
}

export function loadRecommendationLayout(user: string): RecommendationLayout {
  return {
    recommendationOrder: readIds(user, "recommendationOrder"),
    collapsedRecommendations: readIds(user, "collapsedRecommendations"),
  };
}

export function saveRecommendationLayout(user: string, patch: Partial<RecommendationLayout>): void {
  try {
    for (const field of ["recommendationOrder", "collapsedRecommendations"] as const) {
      if (patch[field] !== undefined) localStorage.setItem(storageKey(user, field), JSON.stringify(patch[field]));
    }
  } catch { /* 本次修改仍在当前页面生效。 */ }
}
