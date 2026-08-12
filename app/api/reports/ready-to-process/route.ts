import { NextRequest, NextResponse } from "next/server";
import {
  airtableFetch,
  airtablePaginatedFetch,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BS_BASE_ID = "app2hjpuQoeEL1Rn2";
const BS_ORDER_ENTRY_TABLE = "BS Order Entry";
const BS_INVOICE_TABLE = "BS Invoice";
const BS_INVOICE_ORDER_FIELD = "order_no.";
const BS_INVOICE_PROCESSING_FIELD = "Processing";
const PAKISTAN_TIME_ZONE = "Asia/Karachi";

const FIELDS = {
  orderNo: "Order Number",
  itemCode: "Item Code",
  quantity: "quantity",
  supplier: "Supplier",
  receivedInUae: "Received In UAE",
  receivedInWh1: "received_in_wh_1",
  inStock: "instock",
  soldOut: "Sold Out",
  orderStatus: "Order Status",
  orderStatusAlternative: "Order_status",
  processed: "Processed",
  supplierActivity: "Supplier Activity",
  activityDateTime: "Activity DateTime",
  receivedInUaeDateTime: "Received In UAE DateTime",
} as const;

type AgeBucket = "new" | "old" | "";
type SegmentKind = "new" | "old" | "supplier" | "instock";

type ItemLine = {
  recordId: string;
  orderNo: string;
  itemCode: string;
  quantity: number;
  supplier: string;
  inStock: boolean;
  receivedInUae: boolean;
  receivedInWh1: boolean;
  soldOut: boolean;
  processed: boolean;
  orderStatus: string;
  supplierActivity: string;
  activityDateTime: string;
  receivedInUaeDateTime: string;
  age: AgeBucket;
  sourceIndex: number;
};

type ReadySegment = {
  key: string;
  kind: SegmentKind;
  qty: number;
  supplier: string;
  label: string;
};

type ReadyOrder = {
  orderNo: string;
  totalPcs: number;
  newPcs: number;
  oldPcs: number;
  instockPcs: number;
  undatedReceivedPcs: number;
  formatted: string;
  segments: ReadySegment[];
  latestActivityDateTime: string;
};

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function cleanText(value: unknown): string {
  const raw = firstValue(value);

  if (raw !== null && typeof raw === "object") {
    const objectValue = raw as Record<string, unknown>;
    return String(
      objectValue.name ??
        objectValue.value ??
        objectValue.text ??
        "",
    ).trim();
  }

  return String(raw ?? "").trim();
}

function normalizedValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];

  return values
    .map((item) => {
      if (item !== null && typeof item === "object") {
        const objectValue = item as Record<string, unknown>;
        return String(
          objectValue.name ??
            objectValue.value ??
            objectValue.text ??
            "",
        );
      }

      return String(item ?? "");
    })
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isYesValue(value: unknown): boolean {
  if (value === true || value === 1) return true;

  return normalizedValues(value).some(
    (item) =>
      item === "yes" ||
      item === "true" ||
      item === "1" ||
      item === "checked" ||
      item === "received",
  );
}

function isInStockValue(value: unknown): boolean {
  if (value === true || value === 1) return true;

  return normalizedValues(value).some(
    (item) =>
      item === "yes" ||
      item === "true" ||
      item === "1" ||
      item === "checked" ||
      item === "in stock" ||
      item === "instock" ||
      item === "available",
  );
}

function isSoldOutValue(value: unknown): boolean {
  return normalizedValues(value).some(
    (item) =>
      item === "yes" ||
      item === "true" ||
      item === "1" ||
      item.includes("sold out") ||
      item.includes("stock out"),
  );
}

function normalizeStatus(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function quantityValue(value: unknown): number {
  const quantity = Number(firstValue(value));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function pakistanDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PAKISTAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";

  return year && month && day ? `${year}-${month}-${day}` : "";
}

function classifyAge({
  receivedInUae,
  receivedInUaeDateTime,
  todayKey,
}: {
  receivedInUae: boolean;
  receivedInUaeDateTime: string;
  todayKey: string;
}): AgeBucket {
  if (!receivedInUae) return "";

  // A received item without the dedicated UAE receipt timestamp predates
  // this feature, so treat it as Old instead of incorrectly calling it New.
  if (!receivedInUaeDateTime) return "old";

  const receivedKey = pakistanDateKey(receivedInUaeDateTime);

  if (!receivedKey) return "old";
  if (receivedKey === todayKey) return "new";
  if (receivedKey < todayKey) return "old";

  return "";
}

function groupReceivedSegments(
  lines: ItemLine[],
  showNewOld: boolean,
): ReadySegment[] {
  const grouped = new Map<
    string,
    {
      key: string;
      kind: SegmentKind;
      qty: number;
      supplier: string;
      firstIndex: number;
    }
  >();

  for (const line of lines) {
    const supplier = line.supplier || "No Supplier";
    const useAge = showNewOld && (line.age === "new" || line.age === "old");
    const kind: SegmentKind = useAge
      ? line.age === "new"
        ? "new"
        : "old"
      : "supplier";
    const key = useAge
      ? `${line.age}|${supplier.toLowerCase()}`
      : `supplier|${supplier.toLowerCase()}`;
    const current = grouped.get(key);

    if (current) {
      current.qty += line.quantity;
      continue;
    }

    grouped.set(key, {
      key,
      kind,
      qty: line.quantity,
      supplier,
      firstIndex: line.sourceIndex,
    });
  }

  return Array.from(grouped.values())
    .sort((first, second) => first.firstIndex - second.firstIndex)
    .map((bucket) => {
      const label =
        bucket.kind === "new"
          ? `${formatQty(bucket.qty)} New ${bucket.supplier}`
          : bucket.kind === "old"
            ? `${formatQty(bucket.qty)} Old ${bucket.supplier}`
            : `${formatQty(bucket.qty)} ${bucket.supplier}`;

      return {
        key: bucket.key,
        kind: bucket.kind,
        qty: bucket.qty,
        supplier: bucket.supplier,
        label,
      };
    });
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function buildReadyOrder(orderNo: string, lines: ItemLine[]): ReadyOrder | null {
  const positiveLines = lines.filter((line) => line.quantity > 0);

  if (positiveLines.length === 0) return null;

  const hasProcessedLine = positiveLines.some((line) => line.processed);
  const hasSoldOutLine = positiveLines.some((line) => line.soldOut);
  const hasPendingLine = positiveLines.some(
    (line) => !line.inStock && !line.receivedInUae,
  );

  if (hasProcessedLine || hasSoldOutLine || hasPendingLine) return null;

  const inStockLines = positiveLines.filter((line) => line.inStock);
  const receivedLines = positiveLines.filter(
    (line) => !line.inStock && line.receivedInUae,
  );

  // Every UAE-received line must explicitly show New or Old.
  const showNewOld = receivedLines.length > 0;

  const segments = groupReceivedSegments(receivedLines, showNewOld);
  const totalPcs = positiveLines.reduce((sum, line) => sum + line.quantity, 0);
  const instockPcs = inStockLines.reduce((sum, line) => sum + line.quantity, 0);
  const newPcs = receivedLines
    .filter((line) => line.age === "new")
    .reduce((sum, line) => sum + line.quantity, 0);
  const oldPcs = receivedLines
    .filter((line) => line.age === "old")
    .reduce((sum, line) => sum + line.quantity, 0);
  const undatedReceivedPcs = receivedLines
    .filter((line) => !line.age)
    .reduce((sum, line) => sum + line.quantity, 0);

  if (instockPcs > 0) {
    segments.push({
      key: "instock",
      kind: "instock",
      qty: instockPcs,
      supplier: "",
      label: `${formatQty(instockPcs)} Instock`,
    });
  }

  let detail = segments.map((segment) => segment.label).join(" ");

  if (
    !showNewOld &&
    instockPcs === 0 &&
    segments.length === 1 &&
    segments[0].kind === "supplier" &&
    segments[0].qty === totalPcs
  ) {
    detail = segments[0].supplier;
  }

  const latestActivityDateTime = receivedLines
    .map((line) => line.receivedInUaeDateTime)
    .filter(Boolean)
    .sort((first, second) => {
      const firstTime = new Date(first).getTime();
      const secondTime = new Date(second).getTime();
      return secondTime - firstTime;
    })[0] || "";

  return {
    orderNo,
    totalPcs,
    newPcs,
    oldPcs,
    instockPcs,
    undatedReceivedPcs,
    formatted: `${orderNo} - ${formatQty(totalPcs)} (${detail})`,
    segments,
    latestActivityDateTime,
  };
}

async function fetchOrderEntryRows(token: string) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set(
    "filterByFormula",
    `AND({${FIELDS.orderNo}}!='',OR(LOWER(ARRAYJOIN({${FIELDS.orderStatus}}))='order received',LOWER(ARRAYJOIN({${FIELDS.orderStatusAlternative}}))='order received'))`,
  );

  Object.values(FIELDS).forEach((field) => params.append("fields[]", field));

  return airtablePaginatedFetch({
    baseId: BS_BASE_ID,
    token,
    table: BS_ORDER_ENTRY_TABLE,
    params,
  });
}

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    if (String(session.role || "").trim().toLowerCase() === "supplier") {
      return NextResponse.json(
        {
          success: false,
          message: "Supplier users cannot access the ready-to-process order list",
        },
        { status: 403 },
      );
    }

    const airtable = await getCurrentAirtableBase();

    if (!airtable.canReports) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to view reports" },
        { status: 403 },
      );
    }

    if (airtable.baseId !== BS_BASE_ID) {
      return NextResponse.json(
        {
          success: false,
          code: "BS_BASE_REQUIRED",
          message: "Select BS Order Entry (UAE) to open this report",
        },
        { status: 400 },
      );
    }

    const todayKey = pakistanDateKey(new Date());
    const records = await fetchOrderEntryRows(airtable.token);
    const grouped = new Map<string, ItemLine[]>();

    records.forEach((record: any, sourceIndex: number) => {
      const fields = record.fields || {};
      const orderNo = cleanText(fields[FIELDS.orderNo]);
      const quantity = quantityValue(fields[FIELDS.quantity]);
      const orderStatus =
        cleanText(fields[FIELDS.orderStatus]) ||
        cleanText(fields[FIELDS.orderStatusAlternative]);

      if (
        !orderNo ||
        quantity <= 0 ||
        normalizeStatus(orderStatus) !== "order received"
      ) {
        return;
      }

      const receivedInWh1 = isYesValue(fields[FIELDS.receivedInWh1]);
      const supplierActivity = cleanText(fields[FIELDS.supplierActivity]);
      const activityDateTime = cleanText(fields[FIELDS.activityDateTime]);
      const receivedInUaeDateTime = cleanText(
        fields[FIELDS.receivedInUaeDateTime],
      );
      const receivedInUae = isYesValue(fields[FIELDS.receivedInUae]);
      const line: ItemLine = {
        recordId: record.id,
        orderNo,
        itemCode: cleanText(fields[FIELDS.itemCode]),
        quantity,
        supplier: cleanText(fields[FIELDS.supplier]),
        inStock: isInStockValue(fields[FIELDS.inStock]),
        receivedInUae,
        receivedInWh1,
        soldOut: isSoldOutValue(fields[FIELDS.soldOut]),
        processed: isYesValue(fields[FIELDS.processed]),
        orderStatus,
        supplierActivity,
        activityDateTime,
        receivedInUaeDateTime,
        age: classifyAge({
          receivedInUae,
          receivedInUaeDateTime,
          todayKey,
        }),
        sourceIndex,
      };
      const orderLines = grouped.get(orderNo) || [];
      orderLines.push(line);
      grouped.set(orderNo, orderLines);
    });

    const orders = Array.from(grouped.entries())
      .map(([orderNo, lines]) => buildReadyOrder(orderNo, lines))
      .filter((order): order is ReadyOrder => Boolean(order))
      .sort((first, second) =>
        second.orderNo.localeCompare(first.orderNo, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );

    const summary = orders.reduce(
      (result, order) => {
        result.totalOrders += 1;
        result.totalPcs += order.totalPcs;
        result.newPcs += order.newPcs;
        result.oldPcs += order.oldPcs;
        result.instockPcs += order.instockPcs;
        result.undatedReceivedPcs += order.undatedReceivedPcs;
        return result;
      },
      {
        totalOrders: 0,
        totalPcs: 0,
        newPcs: 0,
        oldPcs: 0,
        instockPcs: 0,
        undatedReceivedPcs: 0,
      },
    );

    return NextResponse.json({
      success: true,
      baseName: airtable.baseName,
      baseId: BS_BASE_ID,
      tableName: BS_ORDER_ENTRY_TABLE,
      timezone: PAKISTAN_TIME_ZONE,
      generatedAt: new Date().toISOString(),
      today: todayKey,
      orders,
      summary,
    });
  } catch (error) {
    return handleApiError(error, "Ready-to-process order list failed");
  }
}

function escapeAirtableText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    if (String(session.role || "").trim().toLowerCase() === "supplier") {
      return NextResponse.json(
        { success: false, message: "Supplier users cannot process orders" },
        { status: 403 },
      );
    }

    const airtable = await getCurrentAirtableBase();

    if (!airtable.canReports) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to process orders" },
        { status: 403 },
      );
    }

    if (airtable.baseId !== BS_BASE_ID) {
      return NextResponse.json(
        {
          success: false,
          code: "BS_BASE_REQUIRED",
          message: "Select BS Order Entry (UAE) to process orders",
        },
        { status: 400 },
      );
    }

    const body = await request.json();
    const orderNos = Array.from(
      new Set(
        (Array.isArray(body?.orderNos) ? body.orderNos : [])
          .map((value: unknown) => String(value || "").trim())
          .filter(Boolean),
      ),
    ) as string[];

    if (orderNos.length === 0) {
      return NextResponse.json(
        { success: false, message: "Select at least one order" },
        { status: 400 },
      );
    }

    const conditions = orderNos.map(
      (orderNo) => `{${BS_INVOICE_ORDER_FIELD}}='${escapeAirtableText(orderNo)}'`,
    );

    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set(
      "filterByFormula",
      conditions.length === 1 ? conditions[0] : `OR(${conditions.join(",")})`,
    );
    params.append("fields[]", BS_INVOICE_ORDER_FIELD);

    const invoiceRecords = await airtablePaginatedFetch({
      baseId: BS_BASE_ID,
      token: airtable.token,
      table: BS_INVOICE_TABLE,
      params,
    });

    if (invoiceRecords.length === 0) {
      return NextResponse.json(
        { success: false, message: "Selected BS Invoice orders were not found" },
        { status: 404 },
      );
    }

    const updates = invoiceRecords.map((record: any) => ({
      id: record.id,
      fields: {
        [BS_INVOICE_PROCESSING_FIELD]: "Yes",
      },
    }));

    for (let index = 0; index < updates.length; index += 25) {
      await airtableFetch({
        baseId: BS_BASE_ID,
        token: airtable.token,
        table: BS_INVOICE_TABLE,
        method: "PATCH",
        fields: {
          records: updates.slice(index, index + 25),
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: `${updates.length} order${updates.length === 1 ? "" : "s"} sent to Processing`,
      processedOrderNos: invoiceRecords.map((record: any) =>
        cleanText(record.fields?.[BS_INVOICE_ORDER_FIELD]),
      ),
    });
  } catch (error) {
    return handleApiError(error, "Order processing update failed");
  }
}

