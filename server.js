const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const { OpenRouter } = require("@openrouter/sdk");

dotenv.config();
const fs = require("fs");
const groupAgentPrompt = require("./groupAgentPromt");
const app = express();
app.use(express.json());

const port = process.env.PORT;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const COMMAND_PREFIX = "agent:";

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const knowledgeBase = JSON.parse(
  fs.readFileSync("./knowledge_base.json", "utf-8"),
);

function buildContext(maxChars = 40000) {
  let combined = "";

  for (const [filename, content] of Object.entries(knowledgeBase)) {
    const chunk = `--- Document: ${filename} ---\n${content}\n\n`;
    if ((combined + chunk).length > maxChars) break;
    combined += chunk;
  }

  return combined;
}
// Add this to server.js
function getRelevantContext(question, maxChars = 30000) {
  const keywords = question.toLowerCase().split(/\s+/);
  const scored = [];

  for (const [filename, content] of Object.entries(knowledgeBase)) {
    // Score each document by how many question keywords appear
    const contentLower = content.toLowerCase();
    const score = keywords.reduce((acc, kw) => {
      return acc + (contentLower.split(kw).length - 1);
    }, 0);

    scored.push({ filename, content, score });
  }

  // Sort by relevance score descending
  scored.sort((a, b) => b.score - a.score);

  let combined = "";
  for (const { filename, content } of scored) {
    const chunk = `--- Document: ${filename} ---\n${content}\n\n`;
    if ((combined + chunk).length > maxChars) break;
    combined += chunk;
  }

  return combined;
}
async function askAI(question) {
  const context = getRelevantContext(question);
  console.log(`📦 Context size: ${context.length} characters`);
  const prompt = groupAgentPrompt({ context, question });

  //   const response = await openrouter.chat.completions.create({
  //     model: "openai/gpt-4o-mini",
  //     messages: [
  //       { role: "system", content: prompt.system },
  //       { role: "user", content: prompt.user },
  //     ],
  //   });
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_tokens: 1000,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://yourdomain.com",
        "X-Title": "WhatsApp Agent",
      },
    },
  );
  console.log(`✅ AI responded with status ${response}`);
  const raw = response.data.choices[0].message.content;
  console.log(`🔍 Raw AI response: ${raw}`);

  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  if (parsed.status === "NOT_FOUND") {
    return "❌ I couldn't find that in the documents.";
  }

  return `${parsed.answer}\n\n📎 *References:* ${parsed.references.join(", ")}`;
}

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

app.listen(port, () => console.log(`🚀 Bot server running on port ${port}`));
