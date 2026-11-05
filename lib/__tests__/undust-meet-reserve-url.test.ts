import { describe, it, expect, afterEach, vi } from "vitest";

// The reserve URL is read once, when the module loads (Next inlines
// NEXT_PUBLIC_* at build time), so each case loads a fresh copy.
async function loadReserveUrl(): Promise<string> {
  vi.resetModules();
  const mod = await import("../undust-meet");
  return mod.UNDUST_MEET_RESERVE_URL;
}

describe("UNDUST_MEET_RESERVE_URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the Ops reserve route when the variable is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_UNDUST_MEET_RESERVE_URL", undefined);
    expect(await loadReserveUrl()).toBe(
      "https://ops.undust.co/api/calendar/meetings/reserve"
    );
  });

  it("defaults to the Ops reserve route when the variable is empty (Docker ARG default)", async () => {
    vi.stubEnv("NEXT_PUBLIC_UNDUST_MEET_RESERVE_URL", "");
    expect(await loadReserveUrl()).toBe(
      "https://ops.undust.co/api/calendar/meetings/reserve"
    );
  });

  it("uses the configured URL when the variable is set", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_UNDUST_MEET_RESERVE_URL",
      "https://visio.example.test/api/meetings/reserve"
    );
    expect(await loadReserveUrl()).toBe(
      "https://visio.example.test/api/meetings/reserve"
    );
  });

  it("is the URL the reservation request goes to", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_UNDUST_MEET_RESERVE_URL",
      "https://visio.example.test/api/meetings/reserve"
    );
    vi.resetModules();
    const { reserveUndustMeetRoom } = await import("../undust-meet");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          room_name: "m-deadbeefdeadbeef",
          organizer_email: "luc@undust.co",
          url: "https://meet.undust.co/m-deadbeefdeadbeef",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await reserveUndustMeetRoom("Point");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://visio.example.test/api/meetings/reserve"
    );
  });
});
