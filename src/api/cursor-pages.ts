import { ApiError } from "./client";

// 索引属于一次查询，重复 ID 保留首次出现的位置并使用最新数据。
export class CursorPages<T> {
  private byId = new Map<string, T>();
  private consumed = new Set<string>();
  private emptyPages = 0;

  constructor(private identity: (item: T) => string) {}

  merge(page: readonly T[], cursor: string | null, nextCursor: string | null, countEmptyPage = true): T[] {
    const ids = page.map(this.identity);
    const emptyPages = countEmptyPage && !ids.some((id) => !this.byId.has(id)) ? this.emptyPages + 1 : 0;
    if (nextCursor && (nextCursor === cursor || this.consumed.has(nextCursor) || emptyPages >= 3))
      throw new ApiError("PAGINATION_STALLED", "Pagination did not advance");

    // 整页通过校验后才更新索引，失败的页面可以用原游标重试。
    this.emptyPages = emptyPages;
    if (cursor) this.consumed.add(cursor);
    page.forEach((item, index) => this.byId.set(ids[index], item));
    return Array.from(this.byId.values());
  }
}
