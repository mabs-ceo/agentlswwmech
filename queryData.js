// queryData.js
const chartData = require("./documents/chartData.json");
const equipment = require("./documents/equipment.json");
const serviceData = require("./documents/service.json");
const fsorData = require("./documents/fsor.json");

// ─── Extract Month ─────────────────────────────────────────────────────────────
function extractMonth(question) {
  const monthMap = {
    jan: "Jan",
    january: "Jan",
    feb: "Feb",
    february: "Feb",
    mar: "Mar",
    march: "Mar",
    apr: "Apr",
    april: "Apr",
    may: "May",
    jun: "Jun",
    june: "Jun",
    jul: "Jul",
    july: "Jul",
    aug: "Aug",
    august: "Aug",
    sep: "Sep",
    september: "Sep",
    oct: "Oct",
    october: "Oct",
    nov: "Nov",
    november: "Nov",
    dec: "Dec",
    december: "Dec",
  };

  const q = question.toLowerCase();
  for (const [word, abbr] of Object.entries(monthMap)) {
    if (q.includes(word)) {
      const earlyMonths = ["Jan", "Feb", "Mar", "Apr"];
      const year = earlyMonths.includes(abbr) ? "26" : "25";
      return `${abbr}-${year}`;
    }
  }
  return null;
}

// ─── Detect Intent ─────────────────────────────────────────────────────────────
function detectIntent(question) {
  const q = question.toLowerCase();

  // PM COUNT
  if (
    (q.includes("how many") || q.includes("count")) &&
    (q.includes("pm") || q.includes("preventive"))
  ) {
    return { type: "PM_COUNT", month: extractMonth(q) };
  }

  // PM LIST
  if (q.includes("pm") || q.includes("scheduled") || q.includes("schedule")) {
    return { type: "PM_LIST", month: extractMonth(q) };
  }

  // SERVICE PACKAGE e.g. ME60.03
  if (q.match(/me\d+\.\d+|ma\d+\.\d+|mp\d+\.\d+/i)) {
    const pkg = question.match(/[A-Z]{2}\d+\.\d+/i)?.[0]?.toUpperCase();
    return { type: "SERVICE_PKG", pkg };
  }

  // REPLACEMENT + MONTH
  if (q.includes("replac") && extractMonth(q)) {
    return { type: "REPLACEMENT_BY_MONTH", month: extractMonth(q) };
  }

  // REPLACEMENT SEARCH
  if (q.includes("replac")) {
    const keyword = question
      .replace(/replacement|replace|what|needs|are|there|any/gi, "")
      .trim();
    return { type: "REPLACEMENT_SEARCH", keyword };
  }

  // FSOR ITEM NUMBER e.g. "fsor item 740"
  if (q.includes("fsor") || q.includes("schedule of rates")) {
    const itemNo = question.match(/item\s*(\d+)/i)?.[1];
    return { type: "FSOR", itemNo: itemNo || null };
  }

  // FSOR COST/RATE SEARCH
  if (
    q.includes("cost") ||
    q.includes("rate") ||
    q.includes("price") ||
    q.includes("how much")
  ) {
    const keyword = question
      .replace(/cost|rate|price|how much|what is|what|is|the|of|for/gi, "")
      .trim();
    return { type: "FSOR_SEARCH", keyword };
  }

  return { type: "GENERAL", query: question };
}

// ─── Run Query ─────────────────────────────────────────────────────────────────
function runQuery(intent) {
  switch (intent.type) {
    case "PM_COUNT": {
      if (!intent.month)
        return {
          found: false,
          reason: "No month specified. Try: 'how many PM for June'",
        };
      const jobs = chartData.jobsByMonth[intent.month];
      if (!jobs)
        return { found: false, reason: `No PM data found for ${intent.month}` };
      return {
        found: true,
        type: "PM_COUNT",
        month: intent.month,
        count: jobs.length,
      };
    }

    case "PM_LIST": {
      if (!intent.month)
        return {
          found: false,
          reason: "No month specified. Try: 'list PM for June'",
        };
      const jobs = chartData.jobsByMonth[intent.month];
      if (!jobs)
        return { found: false, reason: `No PM data found for ${intent.month}` };
      return {
        found: true,
        type: "PM_LIST",
        month: intent.month,
        count: jobs.length,
        jobs: jobs.map((j) => ({
          equipment: j.equipment,
          location: j.location,
          svcPkg: j.svcPkg,
        })),
      };
    }

    case "SERVICE_PKG": {
      const pkg = intent.pkg;
      const def = serviceData.find(
        (s) => s["Service No"]?.toUpperCase() === pkg,
      );
      const equipWithPkg = equipment.filter(
        (e) => e["Svc Pkg"]?.toUpperCase() === pkg,
      );
      if (!def && equipWithPkg.length === 0) {
        return { found: false, reason: `Service package ${pkg} not found` };
      }
      return {
        found: true,
        type: "SERVICE_PKG",
        pkg,
        definition: def || null,
        equipment: equipWithPkg.map((e) => ({
          name: e["Equipment Name"],
          location: e["Location"],
          freq: e["Freq"],
          scheduledMonths: e["Scheduled Months"],
        })),
      };
    }

    case "FSOR": {
      if (intent.itemNo) {
        const item = fsorData.find((f) => f["Item"] === intent.itemNo);
        return item
          ? { found: true, type: "FSOR", data: [item] }
          : { found: false, reason: `FSOR item ${intent.itemNo} not found` };
      }
      return {
        found: true,
        type: "FSOR",
        summary: `There are ${fsorData.length} FSOR line items.`,
        sample: fsorData.slice(0, 5),
        tip: "Ask for a specific item e.g. 'agent: fsor item 740'",
      };
    }

    case "FSOR_SEARCH": {
      const kw = intent.keyword.toLowerCase().trim();
      if (!kw) return { found: false, reason: "No keyword provided" };
      const matches = fsorData.filter((f) =>
        f["Long Description"]?.toLowerCase().includes(kw),
      );
      if (matches.length === 0) {
        return {
          found: false,
          reason: `No FSOR items found for "${intent.keyword}"`,
        };
      }
      return {
        found: true,
        type: "FSOR_SEARCH",
        keyword: intent.keyword,
        total: matches.length,
        items: matches.slice(0, 15),
      };
    }

    case "REPLACEMENT_BY_MONTH": {
      if (!intent.month) return { found: false, reason: "No month detected" };
      const jobs = chartData.jobsByMonth[intent.month] || [];

      const withReplacement = jobs.filter((job) => {
        const svc = serviceData.find((s) => s["Service No"] === job.svcPkg);
        if (!svc) return false;
        const allSteps = [
          ...(svc["Basic Inspection"] || []),
          ...(svc["Additional Tasks"] || []),
          ...(svc["Overhaul"] || []),
        ];
        return allSteps.some((step) => step.toLowerCase().includes("replac"));
      });

      return {
        found: true,
        type: "REPLACEMENT_BY_MONTH",
        month: intent.month,
        total: withReplacement.length,
        items: withReplacement.map((j) => ({
          equipment: j.equipment,
          location: j.location,
          svcPkg: j.svcPkg,
        })),
      };
    }

    case "REPLACEMENT_SEARCH": {
      const kw = intent.keyword.toLowerCase().trim();
      const matches = fsorData.filter(
        (f) =>
          f["Long Description"]?.toLowerCase().includes("replac") &&
          (!kw || f["Long Description"]?.toLowerCase().includes(kw)),
      );
      return {
        found: true,
        type: "REPLACEMENT_SEARCH",
        total: matches.length,
        items: matches.slice(0, 15),
      };
    }

    default:
      return { found: false, type: "GENERAL" };
  }
}

// ─── Format Structured Result (No AI needed) ───────────────────────────────────
function formatStructuredResult(result) {
  switch (result.type) {
    case "PM_COUNT":
      return `📅 *${result.month}*\nTotal PMs scheduled: *${result.count}*`;

    case "PM_LIST":
      return (
        `📅 *PM Schedule — ${result.month}* (${result.count} jobs)\n\n` +
        result.jobs
          .map(
            (j, i) =>
              `${i + 1}. *${j.equipment}*\n   📍 ${j.location} | 🔧 ${j.svcPkg}`,
          )
          .join("\n\n")
      );

    case "SERVICE_PKG": {
      const steps = result.definition?.["Basic Inspection"] || [];
      const equipList = result.equipment.slice(0, 10);
      let text = `🔧 *Service Package: ${result.pkg}*\n\n`;
      if (steps.length) {
        text += `*Inspection Steps:*\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n`;
      }
      text += `*Equipment (${result.equipment.length} total):*\n`;
      text += equipList.map((e) => `• ${e.name} — ${e.location}`).join("\n");
      if (result.equipment.length > 10)
        text += `\n...and ${result.equipment.length - 10} more`;
      return text;
    }

    case "FSOR": {
      if (result.data) {
        return result.data
          .map(
            (r) =>
              `📋 *Item ${r["Item"]}*\n${r["Long Description"]}\n💵 *Rate:* ${r["Rate ($)"] || "No rate"} / ${r["Unit of Measure"] || "-"}`,
          )
          .join("\n\n");
      }
      return (
        `📋 *FSOR Summary*\n${result.summary}\n\n*Sample items:*\n` +
        result.sample
          .map(
            (r) =>
              `• Item ${r["Item"]}: ${r["Long Description"]?.slice(0, 60)}...`,
          )
          .join("\n") +
        `\n\n💡 ${result.tip}`
      );
    }

    case "FSOR_SEARCH":
      return (
        `💰 *FSOR: "${result.keyword}"* (${result.total} found)\n\n` +
        result.items
          .map(
            (r) =>
              `📋 *Item ${r["Item"]}*\n${r["Long Description"]}\n💵 *Rate:* ${r["Rate ($)"] || "No rate"} / ${r["Unit of Measure"] || "-"}`,
          )
          .join("\n\n")
      );

    case "REPLACEMENT_BY_MONTH":
      if (result.total === 0) {
        return `✅ No replacement tasks found in scheduled PMs for *${result.month}*`;
      }
      return (
        `🔧 *Replacements in ${result.month}* (${result.total} items)\n\n` +
        result.items
          .map(
            (j, i) =>
              `${i + 1}. *${j.equipment}*\n   📍 ${j.location} | 🔧 ${j.svcPkg}`,
          )
          .join("\n\n")
      );

    case "REPLACEMENT_SEARCH":
      return (
        `🔧 *Replacement items* (${result.total} found)\n\n` +
        result.items
          .map(
            (r) =>
              `📋 *Item ${r["Item"]}*\n${r["Long Description"]}\n💵 *Rate:* ${r["Rate ($)"] || "No rate"} / ${r["Unit of Measure"] || "-"}`,
          )
          .join("\n\n")
      );

    default:
      return null;
  }
}

module.exports = { detectIntent, runQuery, formatStructuredResult };
