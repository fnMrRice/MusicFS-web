import { instanceIds } from "../fixtures/plugins";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { track } from "../fixtures/dto";

let server: PreviewServer;
const origin = "http://127.0.0.1:18129";
test.beforeAll(async () => {
  server = await preview({
    preview: { host: "127.0.0.1", port: 18129, strictPort: true },
  });
});
test.afterAll(async () => {
  await new Promise<void>((resolve) =>
    server?.httpServer.close(() => resolve()),
  );
});

async function mock(context: BrowserContext, authenticated = true) {
  await context.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session") && !authenticated)
      return route.fulfill({
        status: 401,
        json: { error: { code: "UNAUTHORIZED" } },
      });
    let json: unknown = {
      items: [],
      nextCursor: null,
      nextAfter: null,
      libraryRevision: "1",
    };
    if (path.endsWith("/health/ready"))
      json = {
        product: "MusicFS",
        apiVersion: "1",
        ready: true,
        instanceId: "i18n-test",
      };
    if (path.endsWith("/auth/session"))
      json = { csrfToken: "mock", user: { id: "test-user", role: "admin" } };
    if (path.endsWith("/source-tracks"))
      json = { items: [track], nextCursor: null, libraryRevision: "1" };
    if (path.endsWith("/online-instances"))
      json = {
        items: [
          {
            instanceId: instanceIds.netease,
            name: "网易云公开资料",
            platform: "netease",
            plugin: { features: ["music-source"], id: "musicfs.plugin.source.netease", name: "NetEase Cloud Music", localizedNames: { "zh-CN": "网易云音乐", "zh-TW": "網易雲音樂" } },
            availability: "available",
            capabilities: [],
          },
          {
            instanceId: instanceIds.qqmusic,
            name: "qq-public",
            platform: "qqmusic",
            plugin: { features: ["music-source"], id: "musicfs.plugin.source.qqmusic", name: "QQ Music", localizedNames: { "zh-CN": "QQ音乐", "zh-TW": "QQ音樂" } },
            availability: "available",
            capabilities: [],
          },
          {
            instanceId: instanceIds.applemusic,
            name: "apple-public",
            platform: "applemusic",
            plugin: { features: ["music-source"], id: "musicfs.plugin.source.applemusic", name: "Apple Music", localizedNames: {} },
            availability: "available",
            capabilities: [],
          },
        ],
      };
    if (path.endsWith("/recommendations")) json = { sources: [] };
    return route.fulfill({ json });
  });
}
const selector = (page: Page) => page.locator(".language-select select");

test("browser language chooses English, Simplified Chinese, Traditional Chinese and Japanese before login", async ({
  browser,
}) => {
  for (const [browserLocale, expected, heading] of [
    ["en-GB", "en", "Connect to your music"],
    ["zh-SG", "zh-CN", "连接你的音乐世界"],
    ["zh-HK", "zh-TW", "連接你的音樂世界"],
    ["ja-JP", "ja", "あなたの音楽につながろう"],
    ["de-DE", "en", "Connect to your music"],
  ]) {
    const context = await browser.newContext({ locale: browserLocale });
    try {
      await mock(context, false);
      const page = await context.newPage();
      await page.goto(origin);
      await expect(page.locator("html")).toHaveAttribute("lang", expected);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(selector(page)).toHaveValue("browser");
    } finally {
      await context.close();
    }
  }
});

test("manual language survives refresh, browser changes, account logout and blocked storage", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" });
  try {
    await mock(context, false);
    const page = await context.newPage();
    await page.goto(origin);
    await page
      .getByLabel("Administrator sign-in token")
      .fill("not-a-real-token");
    await selector(page).selectOption("ja");
    await expect(page.getByLabel("管理者ログイントークン")).toHaveValue(
      "not-a-real-token",
    );
    await page.reload();
    await expect(selector(page)).toHaveValue("ja");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "languages", {
        configurable: true,
        value: ["zh-Hant-HK"],
      });
      window.dispatchEvent(new Event("languagechange"));
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await selector(page).selectOption("browser");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "languages", {
        configurable: true,
        value: ["ja-JP"],
      });
      window.dispatchEvent(new Event("languagechange"));
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  } finally {
    await context.close();
  }
  const blocked = await browser.newContext({ locale: "ja-JP" });
  try {
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error("Storage blocked");
      };
      Storage.prototype.setItem = () => {
        throw new Error("Storage blocked");
      };
    });
    await mock(blocked, false);
    const page = await blocked.newPage();
    await page.goto(origin);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await selector(page).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  } finally {
    await blocked.close();
  }
});

test("live language changes preserve search drafts, selections and metadata and translate saved errors", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" });
  try {
    await mock(context);
    const page = await context.newPage();
    const settings = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/#/library`);
    await settings.goto(`${origin}/#/settings?tab=other`);
    await page
      .getByRole("checkbox", {
        name: `Select ${track.displayName}`,
        exact: true,
      })
      .check();
    await selector(settings).selectOption("ja");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(
      page.getByRole("checkbox", {
        name: `${track.displayName} を選択`,
        exact: true,
      }),
    ).toBeChecked();
    await expect(page.getByText("1 曲を選択中", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `${track.displayName} を再生`,
        exact: true,
      }),
    ).toHaveText(track.displayName);
    await page.getByRole("link", { name: "検索", exact: true }).click();
    await page
      .getByRole("textbox", { name: "検索キーワード" })
      .fill("未完成の検索");
    await selector(settings).selectOption("zh-TW");
    await expect(page.getByRole("textbox", { name: "搜尋關鍵字" })).toHaveValue(
      "未完成の検索",
    );
    await expect(
      page.getByRole("combobox", { name: "搜尋來源" }).locator("option"),
    ).toHaveText(["全部來源", "網易雲音樂", "QQ音樂", "Apple Music"]);
    await page.getByRole("button", { name: "專輯", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "專輯搜尋即將接入" }),
    ).toBeVisible();
    await selector(settings).selectOption("en");
    await expect(
      page.getByRole("heading", { name: "Albums search is coming soon" }),
    ).toBeVisible();
    await page.route("**/api/v1/provider-instances", (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: "SOURCE_UNAVAILABLE", requestId: "req-i18n" } },
      }),
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Request ID: req-i18n");
    await selector(settings).selectOption("ja");
    await expect(page.getByRole("alert")).toContainText(
      "リクエスト ID：req-i18n",
    );
    await page.getByRole("tab").last().click();
    await page.getByRole("button", { name: "ログアウト", exact: true }).click();
    await expect(page.locator(".login-page")).toBeVisible();
    await expect(selector(page)).toHaveValue("ja");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("all four languages fit settings and search at narrow widths", async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 480, height: 800 },
  });
  try {
    await mock(context);
    const page = await context.newPage();
    for (const language of ["en", "zh-CN", "zh-TW", "ja"]) {
      await page.goto(`${origin}/#/settings?tab=other`);
      await selector(page).selectOption(language);
      await selector(page).scrollIntoViewIfNeeded();
      await expect(selector(page)).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`settings-${language}.png`),
      });
      for (const tab of await page.getByRole("tab").all()) {
        await tab.click();
        await expect(tab).toBeInViewport();
        await expect(page.getByRole("tabpanel")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await page.goto(`${origin}/#/search`);
      await expect(page.locator(".search-form input")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  } finally {
    await context.close();
  }
});
