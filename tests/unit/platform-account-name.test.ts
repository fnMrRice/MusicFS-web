import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAccount } from "../../src/features/accounts/PlatformAccounts";
import type { Account } from "../../src/features/accounts/usePlatformAccount";
import type { OnlineInstance } from "../../src/api/content";
import * as i18n from "../../src/i18n";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";

const state = vi.hoisted(() => ({ account: null as Account | null }));
vi.mock("../../src/features/accounts/usePlatformAccount", () => ({
  usePlatformAccount: () => ({
    account: state.account, options: { configured: true }, error: "", busy: false,
    qr: "", dialogOpen: false, musicKitReady: false,
    startLogin: vi.fn(), closeLogin: vi.fn(), operation: vi.fn(), authorizeApple: vi.fn(),
  }),
}));

const instance: OnlineInstance = {
  instanceId: instanceIds.netease, platform: "netease", name: "Private instance name",
  plugin: neteasePlugin, availability: "available", capabilities: [],
};

describe("Platform account names", () => {
  beforeEach(() => {
    i18n.setLanguage("zh-CN");
    vi.spyOn(i18n, "useLocale").mockReturnValue({ language: "zh-CN", locale: "zh-CN" });
  });
  afterEach(() => { state.account = null; vi.restoreAllMocks(); i18n.setLanguage("browser"); });

  it.each(["unverified", "expired", "signedOut"])("hides stored usernames until %s credentials are verified", (accountState) => {
    state.account = { state: accountState, accountId: "saved-account", displayName: "Previous listener", membershipTier: "svip" };
    const html = renderToStaticMarkup(createElement(PlatformAccount, { instance }));
    expect(html).toContain("<h4>网易云音乐</h4>");
    expect(html).not.toContain("Previous listener");
    expect(html).not.toContain("SVIP");
    expect(html).not.toContain(instance.instanceId);
  });

  it.each([["free", "非会员"], ["vip", "VIP"], ["svip", "SVIP"]] as const)("displays a verified %s membership", (tier, label) => {
    state.account = { state: "signedIn", accountId: "current", membershipTier: tier };
    const html = renderToStaticMarkup(createElement(PlatformAccount, { instance }));
    expect(html).toContain(`<span>${label}</span>`);
  });

  it("shows only sign-in when the tier is absent, unrecognized, or belongs to another platform", () => {
    state.account = { state: "signedIn", accountId: "current" };
    const render = (platform: string) => renderToStaticMarkup(createElement(PlatformAccount, { instance: { ...instance, platform } }));
    expect(render("netease")).toContain('<span class="muted"><span>已登录</span></span>');
    Object.assign(state.account, { membershipTier: "unrecognized", vipType: 100, expiresAt: "2099-01-01T00:00:00Z" });
    expect(render("netease")).toContain('<span class="muted"><span>已登录</span></span>');
    state.account.membershipTier = "svip";
    expect(render("qqmusic")).not.toContain("SVIP");
  });

  it.each([["en", "Signed in", "Non-member"], ["zh-TW", "已登入", "非會員"], ["ja", "ログイン済み", "非会員"]] as const)(
    "localizes the membership line in %s", (language, signedIn, free) => {
      i18n.setLanguage(language);
      state.account = { state: "signedIn", accountId: "current", membershipTier: "free" };
      const html = renderToStaticMarkup(createElement(PlatformAccount, { instance }));
      expect(html).toContain(`<span>${signedIn}</span> · <span>${free}</span>`);
    },
  );

  it("uses the current verified account username in its heading", () => {
    state.account = { state: "signedIn", accountId: "current-account", displayName: "Current listener" };
    const html = renderToStaticMarkup(createElement(PlatformAccount, { instance }));
    expect(html).toContain("<h4>网易云音乐 · Current listener</h4>");
  });
});
