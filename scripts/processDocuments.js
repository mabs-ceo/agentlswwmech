// scripts/processDocuments.js
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  if (ext === ".json") {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    // Convert JSON to readable text so AI can understand it
    return JSON.stringify(parsed, null, 2);
  }
}

async function buildKnowledgeBase() {
  const docsDir = "./documents";
  //   const files = fs.readdirSync(docsDir);
  const files = fs
    .readdirSync(docsDir)
    .filter((f) =>
      [".pdf", ".docx", ".json"].includes(path.extname(f).toLowerCase()),
    );
  const knowledge = {};

  for (const file of files) {
    const text = await extractText(path.join(docsDir, file));
    knowledge[file] = text;
    console.log(`✅ Processed: ${file}`);
  }

  fs.writeFileSync("./knowledge_base.json", JSON.stringify(knowledge, null, 2));
  console.log("Knowledge base built!");
}

buildKnowledgeBase();
