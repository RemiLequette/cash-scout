import type { AppType } from "@cash-scout/api/app";
import { hc } from "hono/client";

/** Typed client of the API: routes and responses come from the API's types. */
export const api = hc<AppType>("/").api;

/** Error carrying the API's message and HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** For a refused deletion: what still refers to the item. */
    readonly references?: { type: string; count: number }[],
  ) {
    super(message);
  }
}

interface AnyResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** JSON body of the successful responses: validation errors (400) are excluded. */
type OkBody<R> = R extends { status: 400 }
  ? never
  : R extends { json(): Promise<infer T> }
    ? T
    : never;

/** Returns the JSON body of a successful response, or throws an ApiError. */
export async function unwrap<R extends AnyResponse>(response: Promise<R>): Promise<OkBody<R>> {
  const res = await response;
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: string | { issues?: { message: string }[] };
      };
      // Validation errors carry zod issues instead of a message.
      if (typeof body.error === "string") message = body.error;
      else if (body.error?.issues?.[0]) message = body.error.issues[0].message;
    } catch {
      // No JSON body.
    }
    throw new ApiError(message, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as OkBody<R>;
}
