import type { AppType } from "@cash-scout/api/app";
import { hc } from "hono/client";

/** Typed client of the API: routes and responses come from the API's types. */
export const api = hc<AppType>("/").api;
