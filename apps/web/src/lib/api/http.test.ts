import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));
const { isSameOriginMutation } = await import("./http");

const request = (method: string, headers: Record<string, string>) => new Request("http://app.test/api/x", { method, headers });

describe("isSameOriginMutation", () => {
  it("allows safe methods and same-origin mutations", () => {
    expect(isSameOriginMutation(request("GET", { origin: "https://evil.test", host: "app.test" }))).toBe(true);
    expect(isSameOriginMutation(request("POST", { origin: "http://app.test", host: "app.test" }))).toBe(true);
    expect(isSameOriginMutation(request("POST", { host: "app.test" }))).toBe(true);
  });
  it("rejects cross-site mutations", () => {
    expect(isSameOriginMutation(request("POST", { origin: "https://evil.test", host: "app.test" }))).toBe(false);
    expect(isSameOriginMutation(request("DELETE", { origin: "null", host: "app.test" }))).toBe(false);
  });
});
