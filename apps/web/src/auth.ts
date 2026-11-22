import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Sign-in, session and super-user administration, served by the API under /api/auth. */
export const authClient = createAuthClient({ plugins: [adminClient()] });

export const useSession = authClient.useSession;
