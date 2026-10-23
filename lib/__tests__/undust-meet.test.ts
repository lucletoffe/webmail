import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CalendarEvent, CalendarParticipant } from "@/lib/jmap/types";
import {
  reserveUndustMeetRoom,
  isUndustMeetEnabled,
  hostJoinUrl,
  meetingJoinHref,
  UndustMeetError,
  UNDUST_MEET_RESERVE_URL,
} from "../undust-meet";

const GUEST_LINK = "https://meet.undust.co/m-ee59ee19aad5be55";
const HOST_LINK = "https://ops.undust.co/meet/m-ee59ee19aad5be55?host=1";
const LUC = ["luc@undust.co"];

// Forme réelle d'un événement créé par Ops (JMAP luc@, 23/10) : le lien est
// dans locations[].name, l'organisateur est le participant roles.owner.
function makeEvent(
  participants: Record<string, Partial<CalendarParticipant>> | null
): CalendarEvent {
  return {
    "@type": "Event",
    id: "ev1",
    title: "PCM Technologie - Potentiel IA",
    locations: { loc1: { "@type": "Location", name: GUEST_LINK } },
    participants,
  } as unknown as CalendarEvent;
}

const organizedByLuc = makeEvent({
  luc: { roles: { owner: true }, email: "luc@undust.co", calendarAddress: "mailto:luc@undust.co" },
  client: { email: "pb@b-technologie.fr", calendarAddress: "mailto:pb@b-technologie.fr" },
});
const organizedBySomeoneElse = makeEvent({
  other: { roles: { owner: true }, calendarAddress: "mailto:eoger@pcm.eu" },
  luc: { calendarAddress: "mailto:luc@undust.co" },
});

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
            url: "https://meet.undust.co/m-deadbeefdeadbeef",
            host_url: "https://ops.undust.co/meet/m-deadbeefdeadbeef?host=1",
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
        url: "https://meet.undust.co/m-deadbeefdeadbeef",
      });
    });

    it("accepte encore une réponse v1 sans host_url", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              room_name: "m-x",
              organizer_email: "luc@undust.co",
              url: "https://ops.undust.co/meet/m-x",
            }),
            { status: 201 }
          )
        )
      );

      await expect(reserveUndustMeetRoom()).resolves.toEqual({
        roomName: "m-x",
        organizerEmail: "luc@undust.co",
        url: "https://ops.undust.co/meet/m-x",
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

  describe("hostJoinUrl", () => {
    it("donne le lien organisateur Ops quand l'utilisateur organise", () => {
      expect(hostJoinUrl(GUEST_LINK, organizedByLuc, LUC)).toBe(HOST_LINK);
    });

    it("reconnaît l'organisateur sans tenir compte de la casse", () => {
      expect(hostJoinUrl(GUEST_LINK, organizedByLuc, ["Luc@Undust.CO"])).toBe(HOST_LINK);
    });

    it("reconnaît l'organisateur par sa seule calendarAddress", () => {
      const event = makeEvent({
        luc: { roles: { owner: true }, email: null, calendarAddress: "mailto:LUC@undust.co" },
      } as unknown as Record<string, Partial<CalendarParticipant>>);
      expect(hostJoinUrl(GUEST_LINK, event, LUC)).toBe(HOST_LINK);
    });

    it("traite un événement sans participants comme le sien", () => {
      expect(hostJoinUrl(GUEST_LINK, makeEvent(null), LUC)).toBe(HOST_LINK);
      expect(hostJoinUrl(GUEST_LINK, makeEvent({}), [])).toBe(HOST_LINK);
    });

    it("laisse le lien invité à un invité", () => {
      expect(hostJoinUrl(GUEST_LINK, organizedBySomeoneElse, LUC)).toBeNull();
    });

    it("laisse le lien invité quand les identités ne sont pas connues", () => {
      expect(hostJoinUrl(GUEST_LINK, organizedByLuc, [])).toBeNull();
    });

    it("tolère le slash final et les espaces autour du lien", () => {
      expect(hostJoinUrl(` ${GUEST_LINK}/ `, organizedByLuc, LUC)).toBe(HOST_LINK);
    });

    it.each([
      ["un autre service", "https://teams.microsoft.com/meet/313512782314580?p=x"],
      ["le hop Ops déjà organisateur", "https://ops.undust.co/meet/m-ee59ee19aad5be55"],
      ["un ancien lien à jeton", `${GUEST_LINK}?jwt=eyJ0eXAi`],
      ["un fragment", `${GUEST_LINK}#config.prejoinPageEnabled=false`],
      ["du http", "http://meet.undust.co/m-ee59ee19aad5be55"],
      ["un lien sans schéma", "meet.undust.co/m-ee59ee19aad5be55"],
      ["un sous-chemin", "https://meet.undust.co/m-ee59/extra"],
      ["la racine", "https://meet.undust.co/"],
      ["une salle en majuscules", "https://meet.undust.co/M-EE59"],
      ["une salle qui commence par un tiret", "https://meet.undust.co/-m"],
      ["une salle de plus de 64 caractères", `https://meet.undust.co/${"a".repeat(65)}`],
      ["un autre port", "https://meet.undust.co:8443/m-ee59"],
      ["un sous-domaine", "https://x.meet.undust.co/m-ee59"],
    ])("ignore %s", (_label, uri) => {
      expect(hostJoinUrl(uri, organizedByLuc, LUC)).toBeNull();
    });

    it("accepte une salle de 64 caractères", () => {
      const room = "a".repeat(64);
      expect(hostJoinUrl(`https://meet.undust.co/${room}`, organizedByLuc, LUC)).toBe(
        `https://ops.undust.co/meet/${room}?host=1`
      );
    });
  });

  describe("meetingJoinHref", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("ouvre le lien organisateur sur webmail.undust.co", () => {
      vi.stubGlobal("window", { location: { hostname: "webmail.undust.co" } });
      expect(meetingJoinHref(GUEST_LINK, organizedByLuc, LUC)).toBe(HOST_LINK);
    });

    it("laisse le lien tel quel sur une autre instance Bulwark", () => {
      vi.stubGlobal("window", { location: { hostname: "mail.example.com" } });
      expect(meetingJoinHref(GUEST_LINK, organizedByLuc, LUC)).toBe(GUEST_LINK);
    });

    it("laisse le lien tel quel à un invité ou pour un autre lien", () => {
      vi.stubGlobal("window", { location: { hostname: "webmail.undust.co" } });
      expect(meetingJoinHref(GUEST_LINK, organizedBySomeoneElse, LUC)).toBe(GUEST_LINK);
      expect(meetingJoinHref("https://zoom.us/j/123", organizedByLuc, LUC)).toBe("https://zoom.us/j/123");
    });
  });
});
