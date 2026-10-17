// W9: Auth.js endpoints (/api/auth/signin, /callback/github, /session, /signout...).
// This static `auth` segment takes precedence over the mock catch-all app/api/[...path].
import { handlers } from "../../../../auth";

export const { GET, POST } = handlers;
