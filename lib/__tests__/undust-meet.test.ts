import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  reserveUndustMeetRoom,
  isUndustMeetEnabled,
  UndustMeetError,
  UNDUST_MEET_RESERVE_URL,
} from "../undust-meet";

describe("undust-meet", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("isUndustMeetEnabled", () => {
    it("renvoie true sur webmail.undust.co", () => {
      vi.stubGlobal("window", {
        location: { hostname: "webmail.undust.co" },
      });
      expect(isUndustMeetEnabled()).toBe(true);
    });

    it("renvoie false pour un autre serveur mail (fork upstream)", () => {
      vi.stubGlobal("window", {
        location: { hostname: "mail.example.com" },
      });
      expect(isUndustMeetEnabled()).toBe(false);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });
  });

  describe("reserveUndustMeetRoom", () => {
    it("POST credentials:include avec Content-Type JSON et subject trimmed", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            room_name: "m-deadbeefdeadbeef",
            organizer_email: "luc@undust.co",
            url: "https://ops.undust.co/meet/m-deadbeefdeadbeef",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );
      vi.stubGlobal("fetch", fetchMock);

      const room = await reserveUndustMeetRoom("  Appel Thomas  ");

      expect(fetchMock).toHaveBeenCalledWith(
        UNDUST_MEET_RESERVE_URL,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: "Appel Thomas" }),
        })
      );
      expect(room).toEqual({
        roomName: "m-deadbeefdeadbeef",
        organizerEmail: "luc@undust.co",
        url: "https://ops.undust.co/meet/m-deadbeefdeadbeef",
      });
    });

    it("omet subject du payload quand il est vide", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            room_name: "m-x",
            organizer_email: "luc@undust.co",
            url: "https://ops.undust.co/meet/m-x",
          }),
          { status: 201 }
        )
      );
      vi.stubGlobal("fetch", fetchMock);

      await reserveUndustMeetRoom("   ");
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: "{}" })
      );
    });

    it("remonte UndustMeetError avec le status HTTP sur 403", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("", { status: 403 }))
      );

      await expect(reserveUndustMeetRoom()).rejects.toMatchObject({
        name: "UndustMeetError",
        status: 403,
      });
    });

    it("remonte UndustMeetError.status=401 quand la session Ops est expirée", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("", { status: 401 }))
      );

      const err = await reserveUndustMeetRoom().catch((e) => e);
      expect(err).toBeInstanceOf(UndustMeetError);
      expect((err as UndustMeetError).status).toBe(401);
    });

    it("remonte UndustMeetError status=0 sur erreur réseau (CORS, offline)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
      );

      const err = await reserveUndustMeetRoom().catch((e) => e);
      expect(err).toBeInstanceOf(UndustMeetError);
      expect((err as UndustMeetError).status).toBe(0);
    });

    it("rejette une réponse mal formée (invariant de contrat frontière)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ room_name: "m-x" }), { status: 201 })
        )
      );

      await expect(reserveUndustMeetRoom()).rejects.toMatchObject({
        name: "UndustMeetError",
      });
    });
  });
});
