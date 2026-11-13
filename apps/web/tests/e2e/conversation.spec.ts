import { expect, test, type Browser, type Page } from "@playwright/test";

// Scripts used to verify translations arrived in the right language. In CI the
// API runs with mock providers (E2E_MOCK=1), which return "[kn] …"-style output.
const MOCK = process.env.E2E_MOCK === "1";
const KANNADA = MOCK ? /^\[kn\]/ : /[ಀ-೿]/;
const DEVANAGARI = MOCK ? /^\[hi\]/ : /[ऀ-ॿ]/;

// Languages are chosen by their stable code (option value), not by visible label:
// WebKit reports Indic option text differently, and labels can change with copy.
async function chooseLanguage(page: Page, selectLabel: string, code: string) {
  const select = page.getByLabel(selectLabel);
  await expect(select.locator(`option[value="${code}"]`)).toHaveCount(1); // waits for /api/config
  await select.selectOption(code);
}

async function createRoom(page: Page, name: string, language: string) {
  await page.goto("/new");
  await page.getByLabel("Your name").fill(name);
  await chooseLanguage(page, "Your language", language);
  await page.getByRole("checkbox", { name: /I understand/ }).check();
  await page.getByRole("button", { name: "Create room" }).click();
  await page.waitForURL(/\/room\?id=/);
  const code = (await page.getByRole("button", { name: /Join code/ }).first().textContent())!.trim();
  await page.keyboard.press("Escape");
  return code;
}

async function joinRoom(browser: Browser, code: string, name: string, language: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/join?code=${code}`);
  await expect(page.getByText("You're invited to")).toBeVisible();
  await page.getByLabel("Your name").fill(name);
  await chooseLanguage(page, "Language you want to read and hear", language);
  await page.getByRole("checkbox", { name: /I understand/ }).check();
  await page.getByRole("button", { name: "Join conversation" }).click();
  await page.waitForURL(/\/room\?id=/);
  await expect(page.getByText(/Live ·/)).toBeVisible();
  return page;
}

async function typeMessage(page: Page, text: string) {
  const compose = page.getByLabel("Type a message");
  if (!(await compose.isVisible())) await page.getByRole("button", { name: "Type instead" }).click();
  await compose.fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test("English ↔ Kannada exchange, then a Hindi participant joins", async ({ page: a, browser }) => {
  const code = await createRoom(a, "Asha", "en");
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  const b = await joinRoom(browser, code, "Ravi", "kn");
  await expect(a.getByText(/Live · 2 people/)).toBeVisible();

  // A (English) → B sees Kannada translation and can open the original.
  await typeMessage(a, "Shall we meet at the library at five o'clock?");
  const bCard = b.getByRole("article", { name: /Asha, spoke English/ });
  await expect(bCard).toBeVisible();
  await expect(bCard.locator("p[lang='kn']")).toHaveText(KANNADA);
  await bCard.getByRole("button", { name: /Original \(English\)/ }).click();
  await expect(bCard.getByText("Shall we meet at the library at five o'clock?", { exact: true })).toBeVisible();

  // B (Kannada) → A sees English.
  await typeMessage(b, "ಸರಿ, ನಾನು ಐದು ಗಂಟೆಗೆ ಬರುತ್ತೇನೆ.");
  const aCard = a.getByRole("article", { name: /Ravi, spoke Kannada/ });
  // Mock translations look like "[en] <original>"; real ones are English words.
  await expect(aCard.locator("p[lang='en']")).toHaveText(MOCK ? /^\[en\]/ : /[A-Za-z]{3,}/);
  if (!MOCK) await expect(aCard.locator("p[lang='en']")).not.toHaveText(/[ಀ-೿]/);

  // Third participant: Hindi.
  const c = await joinRoom(browser, code, "Meera", "hi");
  await typeMessage(a, "Please bring your notebooks.");
  const cCard = c.getByRole("article", { name: /Asha, spoke English/ }).last();
  await expect(cCard.locator("p[lang='hi']")).toHaveText(DEVANAGARI);
  const bCard2 = b.getByRole("article", { name: /Asha, spoke English/ }).last();
  await expect(bCard2.locator("p[lang='kn']")).toHaveText(KANNADA);

  // Speaker sees delivery status per language.
  await expect(a.getByText(/Delivered in .*Hindi/).last()).toBeVisible();
});

test("guest can ask the speaker to repeat and the speaker is notified", async ({ page: a, browser }) => {
  const code = await createRoom(a, "Asha", "en");
  const b = await joinRoom(browser, code, "Ravi", "kn");
  await typeMessage(a, "Good morning everyone.");
  const card = b.getByRole("article", { name: /Asha/ });
  await expect(card.locator("p[lang='kn']")).toHaveText(KANNADA);
  await card.getByRole("button", { name: /Ask Asha to repeat/ }).click();
  await expect(a.getByText("Ravi asked you to repeat")).toBeVisible();
});

test("viewing a room never requests the microphone", async ({ page, browser }) => {
  const code = await createRoom(page, "Asha", "en");
  const ctx = await browser.newContext({ permissions: [] });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    (window as unknown as { __micRequests: number }).__micRequests = 0;
    const orig = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (orig)
      navigator.mediaDevices.getUserMedia = (c) => {
        (window as unknown as { __micRequests: number }).__micRequests++;
        return orig(c);
      };
  });
  await p.goto(`/join?code=${code}`);
  await p.getByLabel("Your name").fill("Viewer");
  await p.getByRole("checkbox", { name: /I understand/ }).check();
  await p.getByRole("button", { name: "Join conversation" }).click();
  await expect(p.getByText(/Live ·/)).toBeVisible();
  expect(await p.evaluate(() => (window as unknown as { __micRequests: number }).__micRequests)).toBe(0);
});

test("owner ends an ephemeral room for everyone", async ({ page: a, browser }) => {
  const code = await createRoom(a, "Asha", "en");
  const b = await joinRoom(browser, code, "Ravi", "kn");
  await a.getByRole("button", { name: "More" }).click();
  await a.getByRole("menuitem", { name: /Room settings/ }).click();
  await a.getByRole("button", { name: "End conversation for everyone" }).click();
  await a.getByRole("button", { name: "End room" }).click();
  await expect(b.getByText("This conversation has ended.")).toBeVisible();
  await expect(b.getByText("The transcript has been deleted.")).toBeVisible();
});
