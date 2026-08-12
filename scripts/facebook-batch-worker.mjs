import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  resolve,
} from "node:path";

function loadEnvFile(fileName) {
  const filePath =
    resolve(
      process.cwd(),
      fileName
    );

  if (!existsSync(filePath)) {
    return;
  }

  const content =
    readFileSync(
      filePath,
      "utf8"
    );

  for (
    const rawLine of
      content.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const separator =
      line.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const key =
      line.slice(
        0,
        separator
      ).trim();

    let value =
      line.slice(
        separator + 1
      ).trim();

    if (
      (
        value.startsWith('"') &&
        value.endsWith('"')
      ) ||
      (
        value.startsWith("'") &&
        value.endsWith("'")
      )
    ) {
      value =
        value.slice(1, -1);
    }

    if (
      key &&
      process.env[key] ===
        undefined
    ) {
      process.env[key] =
        value;
    }
  }
}

loadEnvFile(".env");
loadEnvFile(".env.production");
loadEnvFile(".env.local");

const baseUrl = String(
  process.env.ERP_BASE_URL ||
    "http://127.0.0.1:3000"
).replace(/\/+$/, "");

const secret = String(
  process.env
    .FACEBOOK_BATCH_WORKER_SECRET ||
    ""
).trim();

const pollSeconds = Math.max(
  10,
  Number(
    process.env
      .FACEBOOK_BATCH_POLL_SECONDS ||
      15
  ) || 15
);

const jobsPerRun = Math.min(
  3,
  Math.max(
    1,
    Number(
      process.env
        .FACEBOOK_BATCH_JOBS_PER_RUN ||
        1
    ) || 1
  )
);

const runOnce =
  String(
    process.env
      .FACEBOOK_BATCH_RUN_ONCE ||
      ""
  ).trim() === "1";

if (!secret) {
  console.error(
    "FACEBOOK_BATCH_WORKER_SECRET is missing."
  );
  process.exit(1);
}

const endpoint =
  `${baseUrl}/api/facebook/batch/process`;

let stopped = false;
let running = false;

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(
      resolve,
      milliseconds
    );
  });
}

async function processQueue() {
  if (running) {
    return;
  }

  running = true;

  try {
    const response = await fetch(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "X-Facebook-Batch-Secret":
            secret,
        },
        body: JSON.stringify({
          limit: jobsPerRun,
        }),
        signal:
          AbortSignal.timeout(
            290000
          ),
      }
    );

    const text =
      await response.text();

    let data = {};

    try {
      data = text
        ? JSON.parse(text)
        : {};
    } catch {
      data = {
        message: text,
      };
    }

    const timestamp =
      new Date()
        .toISOString();

    if (!response.ok) {
      console.error(
        `[${timestamp}] Worker request failed (${response.status}):`,
        data
      );
      return;
    }

    if (
      Number(
        data.processed || 0
      ) > 0 ||
      data.busy
    ) {
      console.log(
        `[${timestamp}]`,
        data
      );
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Facebook Batch worker error:`,
      error instanceof Error
        ? error.message
        : error
    );
  } finally {
    running = false;
  }
}

async function main() {
  console.log(
    "Mysmar Facebook Batch worker started.",
    {
      endpoint,
      pollSeconds,
      jobsPerRun,
      runOnce,
    }
  );

  do {
    await processQueue();

    if (runOnce || stopped) {
      break;
    }

    await sleep(
      pollSeconds * 1000
    );
  } while (!stopped);

  console.log(
    "Mysmar Facebook Batch worker stopped."
  );
}

function stop() {
  stopped = true;
}

process.on(
  "SIGINT",
  stop
);
process.on(
  "SIGTERM",
  stop
);

void main();
