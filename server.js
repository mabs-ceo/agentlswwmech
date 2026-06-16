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

function buildContext() {
  return Object.entries(knowledgeBase)
    .map(([filename, content]) => `--- Document: ${filename} ---\n${content}`)
    .join("\n\n");
}

async function askAI(question) {
  const context = buildContext();
  const prompt = groupAgentPrompt({ context, question });

  const response = await openrouter.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });

  return response.choices[0].message.content;
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
      console.error("❌ Error in agent:", err.message);
      await sendWhatsAppReply(
        chatId,
        "⚠️ Agent encountered an error. Try again.",
      );
    }
  }
});

app.listen(port, () => console.log(`🚀 Bot server running on port ${port}`));
