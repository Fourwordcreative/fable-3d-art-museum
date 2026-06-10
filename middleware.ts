import { NextRequest, NextResponse } from "next/server";

// Site-wide HTTP Basic Auth gate. Set SITE_PASSWORD to enable; if it is unset
// the site stays open (e.g. local dev without the var).
export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const [, pass] = Buffer.from(auth.slice(6), "base64").toString().split(":");
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Timeline Museum"' },
  });
}

export const config = {
  // Gate pages and data routes; hashed build assets are harmless and skipping
  // them avoids a middleware invocation per static file.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
