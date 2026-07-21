import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const administrator = await requireAdmin(request);
    return NextResponse.json({ allowed: true, uid: administrator.uid });
  } catch (error: unknown) {
    const status = authErrorStatus(error);
    return NextResponse.json({ allowed: false }, { status });
  }
}
