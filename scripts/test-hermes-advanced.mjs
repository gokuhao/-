import assert from "node:assert/strict";
import { createServer } from "node:http";
import { HermesClient } from "../dist-electron/hermesClient.js";

async function withHermes(responses, run) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ authorization: request.headers.authorization, body: JSON.parse(body) });
      const content = responses[Math.min(requests.length - 1, responses.length - 1)];
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    await run(new HermesClient({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "test-key", chatTimeoutMs: 2_000 }), requests);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const facts = {
  date: "2026-07-14",
  completedTasks: [{ id: "a", title: "完成测试", actualMinutes: 25 }],
  unfinishedTasks: [{ id: "b", title: "继续开发", status: "todo" }],
  focusMinutes: 25,
  usage: { totalSeconds: 600, byCategory: { work: 600 } },
};
const validReview = JSON.stringify({
  summary: "完成了核心验证",
  insight: "小步测试能降低风险",
  problems: ["仍有安装包待验证"],
  adjustments: ["先完成构建"],
  tomorrow_focus: "验证安装版",
});
await withHermes(["错误格式", validReview], async (client, requests) => {
  const proposal = await client.generateDailyReview(facts);
  assert.equal(proposal.attempts, 2);
  assert.equal(proposal.targetPath, "07 复盘与计划/步步兽/2026-07-14.md");
  assert.match(proposal.content, /完成了核心验证/);
  assert.equal(requests.length, 2);
  assert(requests.every((request) => request.authorization === "Bearer test-key"));
});

await withHermes(["直接回复"], async (client, requests) => {
  const reply = await client.chat("下一步做什么？", { activeTasks: [], projects: [], recentReview: null });
  assert.equal(reply, "直接回复");
  assert.equal(requests.length, 1);
  assert.match(requests[0].body.messages[0].content, /禁止调用任何工具/);
});

const validCoo = JSON.stringify({ summary: "当前应集中交付", risks: ["项目过多"], suggestions: ["只推进一个主线"] });
await withHermes(["{}", validCoo], async (client, requests) => {
  const result = await client.analyzeCoo({ completedTaskCount: 1, unfinishedTaskCount: 2, focusMinutes: 25, usageByCategory: {}, projects: [] });
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.suggestions, ["只推进一个主线"]);
  assert.equal(requests.length, 2);
});

console.log("Hermes 复盘、只读对话、COO 校验与单次重试测试通过");
