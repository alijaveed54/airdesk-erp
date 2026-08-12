import { NextResponse } from "next/server";
import { getCurrentAirtableBase } from "@/lib/airtable";
import {
  getTfmConfigurationStatus,
  getTfmSupportedBase,
  isTfmSupportedBase,
} from "@/lib/tfm";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    if (session.role === "Supplier") {
      return NextResponse.json(
        { success: false, message: "Supplier access is not allowed" },
        { status: 403 },
      );
    }

    const airtable = await getCurrentAirtableBase();
    const supported = isTfmSupportedBase(airtable.baseId);

    return NextResponse.json({
      success: true,
      supported,
      canTestAuthentication: session.role === "Admin",
      selectedBase: {
        baseId: airtable.baseId,
        baseName: airtable.baseName,
        configuredInvoiceTable: airtable.tables.invoice,
      },
      supportedBase: getTfmSupportedBase(airtable.baseId),
      configuration: getTfmConfigurationStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to load TFM configuration",
      },
      { status: 500 },
    );
  }
}
