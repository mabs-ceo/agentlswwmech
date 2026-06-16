// queryData.js
const chartData = require("./documents/chartData.json");
const equipment = require("./documents/equipment.json");
const serviceData = require("./documents/service.json");
const fsorData = require("./documents/fsor.json");

// Detect what the user is asking
function detectIntent(question) {
  const q = question.toLowerCase();

  if (
    (q.includes("how many") || q.includes("count")) &&
    (q.includes("pm") || q.includes("preventive"))
  ) {
    const month = extractMonth(q);
    return { type: "PM_COUNT", month };
  }

  if (q.includes("pm") || q.includes("scheduled") || q.includes("schedule")) {
    const month = extractMonth(q);
    return { type: "PM_LIST", month };
  }

  if (
    q.includes("equipment") &&
    (q.includes("location") || q.includes("where"))
  ) {
    return { type: "EQUIPMENT_LOCATION", query: question };
  }

  if (q.match(/me\d+\.\d+|ma\d+\.\d+|mp\d+\.\d+/i)) {
    const pkg = question.match(/[A-Z]{2}\d+\.\d+/i)?.[0]?.toUpperCase();
    return { type: "SERVICE_PKG", pkg };
  }

  if (q.includes("rate") || q.includes("cost") || q.includes("price")) {
    return { type: "FSOR_RATE", query: question };
  }

  return { type: "GENERAL", query: question };
}

// Extract month from question e.g. "june" → "Jun-25"
function extractMonth(question) {
  const monthMap = {
    jan: "Jan",
    feb: "Feb",
    mar: "Mar",
    apr: "Apr",
    may: "May",
    jun: "Jun",
    jul: "Jul",
    aug: "Aug",
    sep: "Sep",
    oct: "Oct",
    nov: "Nov",
    dec: "Dec",
    january: "Jan",
    february: "Feb",
    march: "Mar",
    april: "Apr",
    june: "Jun",
    july: "Jul",
    august: "Aug",
    september: "Sep",
    october: "Oct",
    november: "Nov",
    december: "Dec",
  };

  const q = question.toLowerCase();
  for (const [word, abbr] of Object.entries(monthMap)) {
    if (q.includes(word)) {
      // Detect year — default to 25/26 based on month
      const earlyMonths = ["Jan", "Feb", "Mar", "Apr"];
      const year = earlyMonths.includes(abbr) ? "26" : "25";
      return `${abbr}-${year}`;
    }
  }
  return null;
}

// Run the right query based on intent
function runQuery(intent) {
  switch (intent.type) {
    case "PM_COUNT": {
      if (!intent.month) return { found: false, reason: "No month specified" };
      const jobs = chartData.jobsByMonth[intent.month];
      if (!jobs) return { found: false, reason: `No data for ${intent.month}` };
      return {
        found: true,
        type: "PM_COUNT",
        month: intent.month,
        count: jobs.length,
      };
    }

    case "PM_LIST": {
      if (!intent.month) return { found: false, reason: "No month specified" };
      const jobs = chartData.jobsByMonth[intent.month];
      if (!jobs) return { found: false, reason: `No data for ${intent.month}` };
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
      if (!def && equipWithPkg.length === 0)
        return { found: false, reason: `Service package ${pkg} not found` };
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

    case "FSOR_RATE": {
      return {
        found: true,
        type: "FSOR_RATE",
        data: fsorData.slice(0, 50), // limit to avoid overload
      };
    }

    default:
      return { found: false, type: "GENERAL" };
  }
}

module.exports = { detectIntent, runQuery };
