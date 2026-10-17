// W9: Auth.js endpoints (/api/auth/signin, /callback/github, /session, /signout...).
// This static `auth` segment takes precedence over the mock catch-all app/api/[...path].
// Auth off (no AUTH_SECRET): answer 404 instead of letting Auth.js throw MissingSecret on every
// header session check (components/auth/HeaderUser.tsx treats a non-OK answer as "auth off").
import type { NextRequest } from "next/server";
import { handlers } from "../../../../auth";
import { authEnabled } from "../../../../lib/auth/paths";

const off = () => Response.json({ error: "auth_disabled" }, { status: 404 });

export const GET = (req: NextRequest) => (authEnabled() ? handlers.GET(req) : off());
export const POST = (req: NextRequest) => (authEnabled() ? handlers.POST(req) : off());
