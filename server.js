// server.js
const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();
const fs = require("fs");
const app = express();
app.use(express.json());
const port = process.env.PORT;

const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const COMMAND_PREFIX = "agent:";

// Load knowledge base once at startup
const knowledgeBase = JSON.parse(
  fs.readFileSync("./knowledge_base.json", "utf-8"),
);

function buildContext() {
  // Combine all docs into one context string
  // With <20 small docs this is totally fine
  return Object.entries(knowledgeBase)
    .map(([filename, content]) => `--- Document: ${filename} ---\n${content}`)
    .join("\n\n");
}

async function askAI(question) {
  const context = buildContext();

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini", // cheap and fast
      messages: [
        {
          role: "system",
          content: `You are a document assistant. Answer ONLY from the provided documents. 
If the answer is not found, say "I couldn't find that in the documents."
Keep answers concise and factual.

DOCUMENTS:
${context}`,
        },
        {
          role: "user",
          content: question,
        },
      ],
      max_tokens: 500,
    },
    {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    },
  );

  return response.data.choices[0].message.content;
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

// whapi.cloud webhook hits this endpoint
app.get("/", (req, res) => {
  res.send("MechAgent is running!");
});
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately
  console.log(JSON.stringify(req.body, null, 2));
  const messages = req.body?.messages || [];

  for (const msg of messages) {
    const text = msg?.text?.body?.trim().toLowerCase() || "";
    const chatId = msg?.chat_id;
    const ALLOWED_GROUP_ID = process.env.GROUP;
    const fromGroup = chatId === ALLOWED_GROUP_ID && chatId?.includes("@g.us"); // WhatsApp group ID format

    // Only respond to group messages with the command prefix
    if (!fromGroup || !text.startsWith(COMMAND_PREFIX)) continue;

    const question = msg.text.body.slice(COMMAND_PREFIX.length).trim();
    if (!question) continue;

    try {
      console.log(`📩 Question: ${question}`);
      const answer = await askAI(question);
      await sendWhatsAppReply(chatId, `🤖 *Agent:*\n${answer}`);
    } catch (err) {
      console.error(err.message);
      await sendWhatsAppReply(
        chatId,
        "⚠️ Agent encountered an error. Try again.",
      );
    }
  }
});

app.listen(port, () => console.log(`🚀 Bot server running on port ${port}`));
