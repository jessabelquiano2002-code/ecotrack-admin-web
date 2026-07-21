import { adminDb } from "../../../lib/firebase-admin";
import { authErrorStatus, requireAdmin } from "../../../lib/serverAuth";

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const { id, truck } = await req.json();

    if (!id || !truck) {
      return Response.json(
        { error: "Missing id or truck" },
        { status: 400 }
      );
    }

    // ✅ CORRECT ADMIN SDK USAGE
    await adminDb.ref(`drivers/${id}`).update({
      truck: truck,
    });

    return Response.json(
      { success: true },
      { status: 200 }
    );

  } catch (error) {
    console.error(error);
    const status = authErrorStatus(error);

    return Response.json(
      { error: status === 500 ? "Failed to update truck" : "Not authorized." },
      { status }
    );
  }
}
