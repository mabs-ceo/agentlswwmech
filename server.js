const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();
const fs = require("fs");
const groupAgentPrompt = require("./groupAgentPromt");
const { detectIntent, runQuery } = require("./queryData");
const app = express();
app.use(express.json());

const port = process.env.PORT;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const COMMAND_PREFIX = "agent:";

// Load knowledge base once at startup
const knowledgeBase = JSON.parse(
  fs.readFileSync("./knowledge_base.json", "utf-8"),
);

// ─── Context Builder ───────────────────────────────────────────────────────────
function getRelevantContext(question, maxChars = 30000) {
  const keywords = question
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  console.log(`🔑 Keywords: ${keywords.join(", ")}`);

  const results = [];

  for (const [filename, content] of Object.entries(knowledgeBase)) {
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const chunks = [];

    for (let i = 0; i < lines.length; i += 10) {
      chunks.push(lines.slice(i, i + 10).join("\n"));
    }

    for (const chunk of chunks) {
      const chunkLower = chunk.toLowerCase();
      const score = keywords.reduce((acc, kw) => {
        return acc + (chunkLower.includes(kw) ? 1 : 0);
      }, 0);

      if (score > 0) {
        results.push({ filename, chunk, score });
      }
    }
  }

  // Sort by relevance score descending
  results.sort((a, b) => b.score - a.score);

  let combined = "";
  for (const { filename, chunk } of results) {
    const piece = `--- From: ${filename} ---\n${chunk}\n\n`;
    if ((combined + piece).length > maxChars) break;
    combined += piece;
  }

  // Fallback — if nothing matched, take first 3000 chars of each doc
  if (!combined) {
    console.log("⚠️ No keyword matches — using fallback");
    for (const [filename, content] of Object.entries(knowledgeBase)) {
      const piece = `--- Document: ${filename} ---\n${content.slice(0, 3000)}\n\n`;
      if ((combined + piece).length > maxChars) break;
      combined += piece;
    }
  }

  return combined;
}

// ─── Format Answer ─────────────────────────────────────────────────────────────
function formatAnswer(parsed) {
  if (parsed.status === "NOT_FOUND") {
    return "❌ I couldn't find that in the documents.";
  }

  let answerText = "";

  if (typeof parsed.answer === "string") {
    answerText = parsed.answer;
  } else if (Array.isArray(parsed.answer)) {
    answerText = parsed.answer
      .map((item, i) => {
        if (typeof item === "object") {
          return `${i + 1}. ${Object.entries(item)
            .map(([k, v]) => `*${k}:* ${v}`)
            .join(" | ")}`;
        }
        return `${i + 1}. ${item}`;
      })
      .join("\n");
  } else if (typeof parsed.answer === "object") {
    answerText = Object.entries(parsed.answer)
      .map(([k, v]) => {
        if (Array.isArray(v)) {
          return `*${k}:*\n${v.map((item, i) => `  ${i + 1}. ${item}`).join("\n")}`;
        }
        return `*${k}:* ${v}`;
      })
      .join("\n");
  }

  return `${answerText}\n\n📎 *References:* ${parsed.references.join(", ")}`;
}

// ─── AI Call ───────────────────────────────────────────────────────────────────
async function askAI(question) {
  // Step 1: Try structured query first
  const intent = detectIntent(question);
  const queryResult = runQuery(intent);

  let context = "";

  if (queryResult.found) {
    // Use precise query result — small and exact
    context = `QUERY RESULT:\n${JSON.stringify(queryResult, null, 2)}`;
    console.log(`✅ Structured query hit: ${intent.type}`);
  } else {
    // Fallback to keyword search in knowledge base
    context = getRelevantContext(question);
    console.log(`⚠️ Falling back to keyword search`);
  }

  console.log(`📦 Context size: ${context.length} characters`);

  const prompt = groupAgentPrompt({ context, question });
  const isListQuery =
    question.toLowerCase().includes("list") ||
    question.toLowerCase().includes("all");
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_tokens: isListQuery ? 4000 : 1000, // bump for list queries
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://agentlswwmech.onrender.com",
        "X-Title": "WhatsApp Agent",
      },
    },
  );

  console.log(`✅ AI responded with status ${response.status}`);
  const raw = response.data.choices[0].message.content;
  console.log(`🔍 Raw AI response: ${raw}`);

  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  return formatAnswer(parsed);
}

// ─── WhatsApp Reply ────────────────────────────────────────────────────────────
async function sendWhatsAppReply(chatId, message) {
  await axios.post(
    "https://gate.whapi.cloud/messages/text",
    { to: chatId, body: message },
    {
      headers: {
        Authorization: `Bearer ${WHAPI_TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );
}

// ─── Routes ────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("MechAgent is running!");
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const messages = req.body?.messages || [];
  const ALLOWED_GROUP_ID = process.env.GROUP;

  for (const msg of messages) {
    const rawText = msg?.text?.body?.trim() || "";
    const text = rawText.toLowerCase();
    const chatId = msg?.chat_id;
    const fromGroup = chatId === ALLOWED_GROUP_ID && chatId?.includes("@g.us");

    if (!fromGroup || !text.startsWith(COMMAND_PREFIX)) continue;

    const question = rawText.slice(COMMAND_PREFIX.length).trim();
    if (!question) continue;

    try {
      console.log(`📩 Question: ${question}`);
      const answer = await askAI(question);
      console.log(`🤖 Answer: ${answer}`);
      await sendWhatsAppReply(chatId, `🤖 *Agent:*\n${answer}`);
    } catch (err) {
      // ❌ This logs undefined when err.response doesn't exist
      console.error(
        "❌ Full error:",
        JSON.stringify(err.response?.data, null, 2),
      );

      // ✅ Log the actual error message too
      console.error("❌ Error message:", err.message);
      console.error(
        "❌ Full error:",
        JSON.stringify(err.response?.data, null, 2),
      );

      await sendWhatsAppReply(
        chatId,
        "⚠️ Agent encountered an error. Try again.",
      );
    }
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(port, () => console.log(`🚀 Bot server running on port ${port}`));
