import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page, type Route } from "playwright";

const APP_CWD = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type RelayConnection = {
  url: string;
  path: string;
};

type RelayMessage = {
  path: string;
  message: Record<string, unknown>;
};

let browser: Browser;
let serverProcess: ChildProcess;
let baseUrl = "";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to determine free port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {
      // server still starting
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startAppServer(port: number): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      resolve(APP_CWD, "node_modules/next/dist/bin/next"),
      "dev",
      "--port",
      String(port),
    ],
    {
      cwd: APP_CWD,
      env: {
        ...process.env,
        NODE_ENV: "development",
        ENABLE_FUNCTIONAL_TEST_PAGES: "1",
        NEXT_PUBLIC_VOICE_RELAY_URL: `ws://127.0.0.1:${port}/ws/voice`,
        NEXT_PUBLIC_OPENAI_VOICE_RELAY_URL: `ws://127.0.0.1:${port}/ws/openai-voice`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[functional-next] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[functional-next] ${chunk}`);
  });

  return child;
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    delay(10_000).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

async function readRelayConnections(page: Page): Promise<RelayConnection[]> {
  return page.evaluate(() => {
    const raw = window.sessionStorage.getItem("__functionalRelayConnections");
    return raw ? (JSON.parse(raw) as RelayConnection[]) : [];
  });
}

async function readRelayMessages(page: Page): Promise<RelayMessage[]> {
  return page.evaluate(() => {
    const raw = window.sessionStorage.getItem("__functionalRelayMessages");
    return raw ? (JSON.parse(raw) as RelayMessage[]) : [];
  });
}

async function waitForText(
  page: Page,
  text: string,
  timeoutMs = 10_000,
  exact = false,
): Promise<void> {
  const locator = page.getByText(text, { exact });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (
      await locator
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000,
  message = "Timed out waiting for condition",
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(message);
}

before(async () => {
  if (process.env.FUNCTIONAL_BASE_URL) {
    baseUrl = process.env.FUNCTIONAL_BASE_URL;
  } else {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = startAppServer(port);
  }
  await waitForHttp(`${baseUrl}/login`);
  browser = await chromium.launch({ headless: true, ...(process.env.FUNCTIONAL_BROWSER_CHANNEL ? { channel: process.env.FUNCTIONAL_BROWSER_CHANNEL } : {}) });
});

after(async () => {
  await browser?.close();
  if (serverProcess) await stopProcess(serverProcess);
});

test("the arbitrary recording URL proxy is not exposed", async () => {
  const response = await fetch(
    `${baseUrl}/api/download/recording?url=${encodeURIComponent(`${baseUrl}/login`)}`,
  );

  assert.equal(response.status, 404);
});

test("login defaults to English and no longer shows a language toggle", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  await page.goto(`${baseUrl}/login`);

  await waitForText(page, "Welcome back");
  assert.equal(await page.getByText("English", { exact: true }).count(), 0);
  assert.equal(await page.getByText("中文", { exact: true }).count(), 0);

  await context.close();
});

test("login honors browser locale and persisted locale cache", async () => {
  const zhContext = await browser.newContext({ locale: "zh-CN" });
  const zhPage = await zhContext.newPage();
  await zhPage.goto(`${baseUrl}/login`);
  await waitForText(zhPage, "欢迎回来");
  await zhContext.close();

  const cachedContext = await browser.newContext({ locale: "en-US" });
  const cachedPage = await cachedContext.newPage();
  await cachedPage.addInitScript(() => {
    window.localStorage.setItem("aural.app.locale", "zh");
  });
  await cachedPage.goto(`${baseUrl}/login`);
  await waitForText(cachedPage, "欢迎回来");
  await cachedContext.close();
});

test("code editor loads Monaco with the secured DOMPurify dependency", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/functional-tests/code-editor`);
  await page.locator(".monaco-editor").waitFor({ state: "visible", timeout: 20_000 });

  assert.equal(await page.locator("select").inputValue(), "typescript");
  assert.equal(
    ((await page.locator(".view-lines").textContent()) ?? "").includes("secureEditor"),
    true,
  );
  assert.deepEqual(pageErrors, []);

  await context.close();
});

test("whiteboard renders and Mermaid conversion works with patched dependencies", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/functional-tests/whiteboard`);
  await page.locator(".excalidraw").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await waitForCondition(
    async () =>
      Number(
        await page.getByTestId("mermaid-element-count").textContent(),
      ) > 0,
    20_000,
    "Expected Mermaid to produce Excalidraw elements",
  );

  assert.equal(await page.getByTestId("mermaid-error").textContent(), "");
  assert.equal(await page.getByTestId("mermaid-math-rendered").textContent(), "true");
  assert.deepEqual(pageErrors, []);

  await context.close();
});

test("English interviews try the voice relay first and fail over to OpenAI", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto(
    `${baseUrl}/functional-tests/voice?language=en&scenario=english-failover`,
  );
  await waitForCondition(
    async () =>
      (await page.getByTestId("harness-ready").textContent()) === "true",
    5_000,
    "Expected functional voice harness mocks to be ready",
  );
  await page.getByRole("button", { name: "Start Interview" }).click();

  await delay(3_500);

  const connections = await readRelayConnections(page);
  assert.deepEqual(
    connections.map((entry) => entry.path),
    ["/ws/voice", "/ws/openai-voice"],
  );

  await context.close();
});

test("Chinese interviews also try the voice relay first and fail over to OpenAI", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto(
    `${baseUrl}/functional-tests/voice?language=zh-CN&scenario=chinese-failover`,
  );
  await waitForCondition(
    async () =>
      (await page.getByTestId("harness-ready").textContent()) === "true",
    5_000,
    "Expected functional voice harness mocks to be ready",
  );
  await page.getByRole("button", { name: "Start Interview" }).click();

  await delay(3_500);

  const connections = await readRelayConnections(page);
  assert.deepEqual(
    connections.map((entry) => entry.path),
    ["/ws/voice", "/ws/openai-voice"],
  );

  await context.close();
});

test("voice interview shows Thinking after user speech finalizes", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  await page.goto(
    `${baseUrl}/functional-tests/voice?language=en&scenario=thinking-after-asr`,
  );
  await waitForCondition(
    async () =>
      (await page.getByTestId("harness-ready").textContent()) === "true",
    5_000,
    "Expected functional voice harness mocks to be ready",
  );
  await page.getByRole("button", { name: "Start Interview" }).click();

  await waitForText(page, "Thinking...", 8_000);
  const bodyText = (await page.locator("body").textContent()) ?? "";
  assert.equal(bodyText.includes("I led a reporting dashboard project"), true);
  assert.equal(
    bodyText.includes("Speak naturally — AI will respond automatically"),
    false,
  );

  await context.close();
});

test("voice interview keeps Thinking visible until the agent response returns", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  await page.goto(
    `${baseUrl}/functional-tests/voice?language=en&scenario=thinking-until-response`,
  );
  await waitForCondition(
    async () =>
      (await page.getByTestId("harness-ready").textContent()) === "true",
    5_000,
    "Expected functional voice harness mocks to be ready",
  );
  await page.getByRole("button", { name: "Start Interview" }).click();

  await waitForText(page, "Thinking...", 8_000);
  await delay(500);
  assert.equal(
    await page.getByText("Thinking...", { exact: true }).first().isVisible(),
    true,
  );
  let bodyText = (await page.locator("body").textContent()) ?? "";
  assert.equal(
    bodyText.includes("Speak naturally — AI will respond automatically"),
    false,
  );

  await waitForText(page, "Thanks for explaining that project.", 8_000);
  await waitForCondition(
    async () =>
      !(await page
        .getByText("Thinking...", { exact: true })
        .first()
        .isVisible()
        .catch(() => false)),
    5_000,
    "Expected Thinking to clear once the agent response is visible",
  );
  bodyText = (await page.locator("body").textContent()) ?? "";
  assert.equal(bodyText.includes("Thanks for explaining that project."), true);

  await context.close();
});

test("Qwen snapshots replace phantom drafts in the actual voice UI and allow empty retractions", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.route("**/api/voice/save", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.route("**/api/session/upload", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"url":"","path":""}' }));
  await page.goto(`${baseUrl}/functional-tests/voice?language=en&scenario=qwen-transcript-revision`);
  await waitForCondition(async () => (await page.getByTestId("harness-ready").textContent()) === "true", 5_000);
  await page.getByRole("button", { name: "Start Interview" }).click();
  const status = page.getByTestId("voice-status-scroll");
  await waitForCondition(async () => ((await status.textContent()) ?? "").includes("Thank you Hello we can hello"), 8_000);
  await waitForCondition(async () => ((await status.textContent()) ?? "").includes("Hello. Can you hear me"), 3_000);
  assert.equal(((await status.textContent()) ?? "").includes("Thank you"), false);
  // This harness has no microphone track, so later live drafts need not be visible.
  // Allow the timed empty final to arrive and assert the committed transcript instead.
  await delay(2_000);
  const body = (await page.locator("body").textContent()) ?? "";
  assert.equal(body.includes("Hello. Can you hear me?"), true);
  assert.equal(body.includes("Thank you Hello we can hello"), false, "obsolete draft must not be committed to transcript");
  assert.equal(body.includes("phantom revision"), false, "empty final must not promote discarded text");
  await context.close();
});

test("live captions stay visible while drafts pulse across pending and resumed speech", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.route("**/api/voice/save", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.route("**/api/session/upload", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"url":"","path":""}' }));
  await page.goto(`${baseUrl}/functional-tests/voice?language=en&scenario=qwen-caption-stability`);
  await waitForCondition(async () => (await page.getByTestId("harness-ready").textContent()) === "true", 5_000);
  await page.getByRole("button", { name: "Start Interview" }).click();
  await page.getByTestId("live-user-transcript").waitFor({ state: "visible", timeout: 10_000 });
  const caption = await page.getByTestId("voice-user-caption").elementHandle();
  const live = await page.getByTestId("live-user-transcript").elementHandle();
  assert.ok(caption && live);
  // Sample through both processing/listening transitions: the same DOM nodes
  // remain visible while the draft pulses continuously across provider updates.
  for (let i = 0; i < 32; i++) {
    assert.equal(await caption.evaluate(el => el.isConnected && el.getBoundingClientRect().height > 0), true);
    assert.equal(await live.evaluate(el => el.isConnected && getComputedStyle(el).animationName === "pulse"), true);
    assert.equal((await caption.textContent())?.includes("My earlier answer"), false, "current draft must take priority over a previous user turn");
    await delay(60);
  }
  await page.getByTestId("live-user-transcript").waitFor({ state: "hidden", timeout: 3_000 });
  assert.equal(await caption.evaluate(el => el.isConnected), true, "caption must survive final commit");
  const final = "I start by understanding the problem. Then I define success and test scalability.";
  assert.ok((await caption.textContent())?.includes(final));
  await context.close();
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`listening and transcription feedback reflects live speech and finalization (${reducedMotion})`, async () => {
    const context = await browser.newContext({ locale: "en-US", reducedMotion });
    const page = await context.newPage();
    await page.route("**/api/voice/save", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
    await page.route("**/api/session/upload", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"url":"","path":""}' }));
    await page.goto(`${baseUrl}/functional-tests/voice?language=en&scenario=listening-feedback`);
    await waitForCondition(async () => (await page.getByTestId("harness-ready").textContent()) === "true", 5_000);
    await page.getByRole("button", { name: "Start Interview" }).click();
    await page.locator('[data-tour="voice-mic"] button').click();
    const listening = page.getByTestId("voice-listening-feedback");
    await listening.waitFor({ state: "visible", timeout: 10_000 });
    assert.ok((await listening.textContent())?.includes("TestInterviewer is listening"));
    assert.equal(await listening.locator('span[aria-hidden="true"]').evaluate(el => getComputedStyle(el).animationName), reducedMotion === "reduce" ? "none" : "pulse");
    const live = page.getByTestId("live-user-transcript");
    await live.waitFor({ state: "visible", timeout: 8_000 });
    assert.equal((await live.getByTestId("transcription-progress").textContent())?.trim(), "Listening…");
    assert.equal(await page.getByText("Transcribing your answer live", { exact: true }).count(), 0);
    const transcriptBounds = await live.locator("span.text-muted-foreground").boundingBox();
    const statusBounds = await live.getByTestId("transcription-progress").boundingBox();
    assert.ok(transcriptBounds && statusBounds && statusBounds.y >= transcriptBounds.y + transcriptBounds.height, "transcription status belongs below the text");
    assert.equal(await live.evaluate(el => getComputedStyle(el).animationName), reducedMotion === "reduce" ? "none" : "pulse", "draft text pulses unless reduced motion is requested");
    const processing = page.getByTestId("voice-processing-feedback");
    await processing.waitFor({ state: "visible", timeout: 3_000 });
    assert.ok((await processing.textContent())?.includes("Finishing transcription"));
    assert.equal((await processing.textContent())?.includes("Thinking"), false, "don't claim AI is generating a reply before ASR finishes");
    await listening.waitFor({ state: "visible", timeout: 3_000 });
    assert.equal((await live.getByTestId("transcription-progress").textContent())?.trim(), "Listening…", "resumed speech returns to listening");
    await waitForCondition(async () => ((await processing.textContent().catch(() => "")) ?? "").includes("Thinking"), 5_000);
    assert.equal(await page.getByTestId("transcription-progress").count(), 0, "transcription indicators stop after a final is accepted");
    await context.close();
  });
}

test("discarded ASR finals clear the voice processing state", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto(
    `${baseUrl}/functional-tests/voice?language=en&scenario=asr-cancelled`,
  );
  await waitForCondition(
    async () =>
      (await page.getByTestId("harness-ready").textContent()) === "true",
    5_000,
    "Expected functional voice harness mocks to be ready",
  );
  await page.getByRole("button", { name: "Start Interview" }).click();

  const voiceStatus = page.getByTestId("voice-status-scroll");
  await waitForCondition(
    async () =>
      (await voiceStatus.getByText("Finishing transcription…", { exact: true }).count()) > 0,
    8_000,
    "Expected the pending ASR final to show the processing indicator",
  );
  await waitForCondition(
    async () =>
      (await voiceStatus.getByText("Finishing transcription…", { exact: true }).count()) === 0,
    3_000,
    "Expected the cancelled ASR final to clear the processing indicator",
  );
  assert.equal(
    ((await voiceStatus.textContent()) ?? "").includes(
      "Yes. And so I think communication is critical.",
    ),
    false,
  );

  await context.close();
});

test("long live transcripts scroll inside the voice panel without moving the controls", async () => {
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto(
    `${baseUrl}/functional-tests/voice?language=en&scenario=long-transcript-layout`,
  );
  await waitForCondition(
    async () =>
      (await page.getByTestId("harness-ready").textContent()) === "true",
    5_000,
    "Expected functional voice harness mocks to be ready",
  );
  await page.getByRole("button", { name: "Start Interview" }).click();

  const voiceStatusScroll = page.getByTestId("voice-status-scroll");
  await waitForCondition(
    async () =>
      voiceStatusScroll.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    10_000,
    "Expected the long transcript to overflow inside the voice panel",
  );

  const scrollMetrics = await voiceStatusScroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    contentTop:
      element.firstElementChild?.getBoundingClientRect().top ?? 0,
    panelTop: element.getBoundingClientRect().top,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  assert.equal(scrollMetrics.overflowY, "auto");
  assert.ok(scrollMetrics.clientHeight > 0);
  assert.ok(scrollMetrics.scrollHeight > scrollMetrics.clientHeight);
  assert.ok(scrollMetrics.contentTop >= scrollMetrics.panelTop);

  const controls = await page.locator('[data-tour="voice-progress"]').boundingBox();
  assert.ok(controls);
  assert.ok(controls.y + controls.height <= 720);

  await context.close();
});

test("voice completion shows the farewell, waits for final save, and only then notifies the parent", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  let resolveSave: (() => void) | null = null;
  const saveBodies: unknown[] = [];
  const recordingBodies: Array<Record<string, unknown>> = [];
  const audioUrl = "https://media.example.invalid/functional-recording.webm";

  // Audio-only sessions now persist their recording before the final transcript.
  // Mock both storage boundaries so this fixture never calls the placeholder DB.
  await page.route("**/api/session/upload", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: audioUrl, path: "functional-recording.webm" }),
    });
  });
  await page.route("**/api/trpc/session.saveRecording", async (route: Route) => {
    const payload = JSON.parse(route.request().postData() || "{}").json;
    recordingBodies.push(payload);
    assert.equal(saveBodies.length, 0, "Recording metadata must precede final transcript save");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("**/api/voice/save", async (route: Route) => {
    saveBodies.push(JSON.parse(route.request().postData() || "{}"));
    await new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto(
    `${baseUrl}/functional-tests/voice?language=en&scenario=farewell-complete`,
  );
  await waitForCondition(
    async () =>
      (await page.getByTestId("harness-ready").textContent()) === "true",
    5_000,
    "Expected functional voice harness mocks to be ready",
  );
  await page.getByRole("button", { name: "Start Interview" }).click();
  await page.locator('[data-tour="voice-mic"] button').click();
  await page.locator('[data-tour="voice-mic"]').getByText("Mute", { exact: true }).waitFor();

  await delay(1_500);
  const earlyBodyText = (await page.locator("body").textContent()) ?? "";
  assert.equal(
    earlyBodyText.includes(
      "Understood, we're all set. Thanks for your time today and take care.",
    ),
    true,
  );
  assert.equal(earlyBodyText.includes("Thank you!"), false);
  assert.equal(
    await page.getByTestId("parent-complete").textContent(),
    "false",
  );

  await waitForCondition(
    async () => saveBodies.length === 1,
    6_000,
    "Expected final voice save to be sent once",
  );

  const [savePayload] = saveBodies as Array<Record<string, unknown>>;
  assert.equal(savePayload.complete, true);
  assert.equal(recordingBodies.length, 1, "Audio-only recording metadata is saved once");
  assert.equal(recordingBodies[0].audioRecordingUrl, audioUrl);
  assert.ok(Number(recordingBodies[0].audioDuration) > 0);
  assert.equal(
    await page.getByTestId("parent-complete").textContent(),
    "false",
  );

  const fn = resolveSave as (() => void) | null;
  if (fn) fn();

  await delay(500);
  assert.equal(await page.getByTestId("parent-complete").textContent(), "true");
  assert.equal(
    ((await page.locator("body").textContent()) ?? "").includes("Thank you!"),
    true,
  );
  const relayMessages = await readRelayMessages(page);
  assert.equal(
    relayMessages.some(
      ({ path, message }) =>
        path === "/ws/voice" &&
        message.type === "playback_ended" &&
        message.utteranceId === "functional-farewell-1",
    ),
    true,
    "Expected the browser to acknowledge the completed relay utterance",
  );

  await context.close();
});


test("interview creation preserves both drafts across tabs and allows prompt resizing", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/functional-tests/interview-drafts`);
    const prompt = page.locator('textarea:visible').first();
    await prompt.fill("Design a backend engineering interview with practical debugging.");
    const before = await prompt.boundingBox();
    assert.ok(before);
    assert.equal(await prompt.evaluate(el => getComputedStyle(el).resize), "vertical");
    await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width - 3, before.y + before.height + 100, { steps: 10 });
    await page.mouse.up();
    const afterResize = await prompt.boundingBox();
    assert.ok(afterResize && afterResize.height > before.height + 50);
    await page.getByRole("tab", { name: "Manual", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Manual draft title");
    await page.getByRole("tab", { name: "AI Generator", exact: true }).click();
    assert.equal(await prompt.inputValue(), "Design a backend engineering interview with practical debugging.");
    assert.equal((await prompt.boundingBox())?.height, afterResize.height);
    await page.getByRole("tab", { name: "Manual", exact: true }).click();
    assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Manual draft title");
    assert.equal(await page.getByRole("tabpanel").count(), 1, "Only the active draft is exposed to accessibility navigation");
  } finally { await page.close(); }
});

test("video consent with camera denial never connects the interview relay", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.route("**/api/session/video?*", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":true}' }));
  await page.goto(`${baseUrl}/functional-tests/voice?language=en&scenario=english-failover&recordWebcam=1`);
  await waitForCondition(async () => (await page.getByTestId("harness-ready").textContent()) === "true");
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints?.video) throw new DOMException("Camera denied for test", "NotAllowedError");
      return original(constraints);
    };
  });
  assert.equal(await page.getByRole("checkbox", { name: /Record my webcam/ }).count(), 0);
  await page.getByRole("button", { name: "Start Interview" }).click();
  await waitForText(page, "Camera denied for test");
  assert.deepEqual(await readRelayConnections(page), []);
  assert.equal(await page.getByTestId("parent-complete").textContent(), "false");
  await context.close();
});

test("video upload failure keeps recovery visible and preserves audio before parent completion", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  let offline = true;
  let audioSaved = false;
  let finalized = false;
  await page.route("**/api/session/video?*", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":true}' }));
  await page.route("**/api/session/video", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"state":"capturing"}' }));
  await page.route("**/api/session/video/*", async route => {
    const body = route.request().postDataJSON();
    if (offline) { await route.fulfill({ status: 503, body: "{}" }); return; }
    if (body.action === "finalize") { finalized = true; assert.equal(audioSaved, true); }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body.action === "upload" ? { acknowledged: true } : { state: "processing" }) });
  });
  await page.route("**/api/session/upload", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"url":"https://media.example.invalid/audio.webm"}' }));
  await page.route("**/api/trpc/session.saveRecording", async route => { audioSaved = true; await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  await page.route("**/api/voice/save", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto(`${baseUrl}/functional-tests/voice?language=en&scenario=farewell-complete&recordWebcam=1`);
  await waitForCondition(async () => (await page.getByTestId("harness-ready").textContent()) === "true");
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints?.video) {
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
        const stream = canvas.captureStream(24);
        let frame=0;
        const draw = setInterval(() => { const ctx=canvas.getContext("2d")!;ctx.fillStyle=frame++%2?"red":"blue";ctx.fillRect(0, 0, 640, 480); }, 40);
        stream.getVideoTracks()[0].addEventListener("ended", () => clearInterval(draw));
        return stream;
      }
      return original(constraints);
    };
  });
  assert.equal(await page.getByRole("checkbox", { name: /Record my webcam/ }).count(), 0);
  await page.getByRole("button", { name: "Start Interview" }).click();
  await page.locator('[data-tour="voice-mic"] button').click();
  await page.locator('[data-tour="voice-mic"]').getByText("Mute", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry video upload" }).waitFor({ timeout: 15000 });
  assert.equal(audioSaved, true);
  assert.equal(await page.getByTestId("parent-complete").textContent(), "false");
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  try {
    await waitForCondition(async () => (await page.getByTestId("parent-complete").textContent()) === "true");
  } catch (error) {
    console.error("Synthetic recovery fixture state:", await page.locator("body").innerText());
    console.error("Synthetic recovery manifests:", await page.evaluate(async () => {
      const request = indexedDB.open("aural-video-spike-v1", 1);
      return new Promise(resolve => { request.onsuccess = () => { const db=request.result;const rows=db.transaction("manifests").objectStore("manifests").getAll();rows.onsuccess=()=>{resolve(rows.result.map(m=>({sealed:m.sealed,partial:m.partial,chunks:m.chunks})));db.close();}; }; });
    }));
    throw error;
  }
  assert.equal(finalized, true);
  await context.close();
});


test("camera checklist previews before consent, releases camera and supports denial retry", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/functional-tests/voice?scenario=camera-checklist`);
    await waitForCondition(async () => (await page.getByTestId("harness-ready").textContent()) === "true");
    await page.evaluate(() => {
      let denied = true;
      navigator.mediaDevices.getUserMedia = async () => {
        if (denied) { denied = false; throw new DOMException("Denied", "NotAllowedError"); }
        const canvas = document.createElement("canvas");
        canvas.width = 640; canvas.height = 480;
        return canvas.captureStream(1);
      };
    });
    await page.getByRole("button", { name: "Test Camera", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Unable to access camera" }).waitFor();
    assert.equal(await page.getByTestId("camera-ready").textContent(), "false");
    assert.equal(await page.getByRole("button", { name: "Next", exact: true }).isEnabled(), true);
    await page.getByRole("button", { name: "Test Camera", exact: true }).click();
    await page.getByLabel("Camera preview").waitFor();
    assert.equal(await page.getByTestId("camera-ready").textContent(), "false");
    assert.equal(await page.getByRole("button", { name: "Next", exact: true }).isDisabled(), true);
    const track = await page.getByLabel("Camera preview").evaluateHandle(el => (el as HTMLVideoElement).srcObject instanceof MediaStream ? ((el as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0] : null);
    await page.getByRole("button", { name: "Use Camera & Record" }).click();
    assert.equal(await page.getByTestId("camera-ready").textContent(), "true");
    assert.equal(await track.evaluate(value => value?.readyState), "ended");
    await page.getByRole("button", { name: "Continue without video recording" }).click();
    assert.equal(await page.getByTestId("camera-ready").textContent(), "false");
  } finally { await page.close(); }
});

test("failed video connection releases camera without recording and can retry", async () => {
  const page = await browser.newPage();
  let created = 0;
  const recordingIds = new Set<string>();
  try {
    await page.route("**/api/session/video?*", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":true}' }));
    await page.route("**/api/session/video", route => { created++; recordingIds.add(route.request().postDataJSON().id); return route.fulfill({ status: 200, contentType: "application/json", body: '{}' }); });
    await page.goto(`${baseUrl}/functional-tests/voice?scenario=connection-failure&recordWebcam=1`);
    await waitForCondition(async () => (await page.getByTestId("harness-ready").textContent()) === "true");
    const installCamera = () => page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        if (!constraints?.video) return original(constraints);
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
        const stream = canvas.captureStream(1);
        stream.getVideoTracks()[0].addEventListener("ended", () => {});
        return stream;
      };
    });
    await installCamera();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt === 2) {
        await page.reload();
        await waitForCondition(async () => (await page.getByTestId("harness-ready").textContent()) === "true");
        await installCamera();
      }
      await page.getByRole("button", { name: "Start Interview", exact: true }).click();
      await page.getByText("The interview could not connect. Your camera is off. Please try again.", { exact: true }).waitFor();
      assert.equal(await page.getByText("REC", { exact: true }).count(), 0);
      assert.equal(await page.getByText("Webcam recording", { exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Retry video upload" }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Start Interview", exact: true }).isEnabled(), true);
    }
    assert.equal(created, 2, "Reload reauthorizes the empty attempt");
    assert.equal(recordingIds.size, 1, "Retries and reload retain the prepared recording identity");
  } finally { await page.close(); }
});


test("encoded recording keeps pre-start microphone, mute, replacement mic and interviewer", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/functional-tests/voice?scenario=recorded-voices`);
    await page.getByRole("button", { name: "Test recorded voices" }).click();
    await waitForCondition(async () => !!(await page.getByTestId("recorded-voices").textContent()), 20000);
    const result = JSON.parse((await page.getByTestId("recorded-voices").textContent())!);
    assert.equal(result.error, undefined);
    for (const key of ["beforeStartMic", "interviewer", "unmutedMic", "interviewerAfterUnmute"]) {
      assert.ok(result[key] > 0.025, `${key} missing from encoded recording: ${JSON.stringify(result)}`);
    }
    assert.ok(result.mutedMic < 0.005, "Muted microphone must not be recorded");
  } finally { await page.close(); }
});
