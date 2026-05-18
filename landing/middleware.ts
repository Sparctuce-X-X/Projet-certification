import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

// Skip statics + Next internals — match seulement /admin/*.
// Le check is_admin (DB query) est fait dans app/admin/layout.tsx,
// pas ici (edge runtime, on garde léger).
export const config = {
  matcher: ["/admin/:path*"],
};
