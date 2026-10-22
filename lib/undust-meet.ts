// Réservation d'une salle visio sur l'infra undust (meet.undust.co), depuis
// le calendrier Bulwark. Mandat Luc 2026-10-22, feat/calendar-meet-link.
//
// Contrat frontière avec le fork Rails Nexus (controller
// `Api::Calendar::MeetingReservationsController`, route
// `POST /api/calendar/meetings/reserve` sur ops.undust.co) :
//   - Fetch cross-origin credentialed (`credentials: "include"`) : ops est
//     same-site (undust.co) donc le cookie de session Pocket ID voyage.
//   - Serveur vérifie `Origin: https://webmail.undust.co` ET
//     `current_user_email == Meeting.calendar_organizer`. Un utilisateur non
//     organizer reçoit 403 ; un autre site reçoit 403 au preflight.
//   - Réponse 201 : { room_name, organizer_email, url }. `url` est le lien à
//     écrire dans l'événement d'agenda — c'est le hop ops qui route Luc
//     authentifié en modo et un invité anonyme en guest sur le MÊME chemin.
//
// Un fetch échoue silencieusement si la session Pocket ID est expirée ou si
// l'utilisateur n'est pas l'organizer : l'UI remonte une erreur utilisateur,
// pas de retry automatique (une boucle sur 403 est inutile).

const DEFAULT_URL = "https://ops.undust.co/api/calendar/meetings/reserve";

export const UNDUST_MEET_RESERVE_URL =
  process.env.NEXT_PUBLIC_UNDUST_MEET_RESERVE_URL || DEFAULT_URL;

// Bulwark est utilisé par plusieurs serveurs mail — la fonctionnalité
// « lien visio undust » n'a aucun sens hors instance undust. On gate sur une
// liste blanche d'origines ; sinon le bouton n'est tout simplement pas rendu.
const UNDUST_HOSTS = new Set([
  "webmail.undust.co",
  // Dev local : vitest tourne sous jsdom (location.host = "localhost") ;
  // le bouton reste disponible pour les tests unitaires.
  "localhost",
  "127.0.0.1",
]);

export function isUndustMeetEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return UNDUST_HOSTS.has(window.location.hostname);
}

export interface ReservedMeetRoom {
  roomName: string;
  organizerEmail: string;
  url: string;
}

export class UndustMeetError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "UndustMeetError";
  }
}

export async function reserveUndustMeetRoom(
  subject?: string,
  init?: { signal?: AbortSignal }
): Promise<ReservedMeetRoom> {
  const payload: Record<string, string> = {};
  const trimmed = (subject ?? "").trim();
  if (trimmed) payload.subject = trimmed;

  let res: Response;
  try {
    res = await fetch(UNDUST_MEET_RESERVE_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: init?.signal,
    });
  } catch (e) {
    // Erreur réseau (DNS, offline, CORS block). On ne laisse pas remonter
    // l'exception native brute — l'UI veut un message stable.
    throw new UndustMeetError(
      e instanceof Error ? e.message : "network_error",
      0
    );
  }

  if (!res.ok) {
    throw new UndustMeetError(`http_${res.status}`, res.status);
  }

  const body = (await res.json()) as {
    room_name?: unknown;
    organizer_email?: unknown;
    url?: unknown;
  };

  if (
    typeof body.room_name !== "string" ||
    typeof body.organizer_email !== "string" ||
    typeof body.url !== "string"
  ) {
    throw new UndustMeetError("invalid_response", res.status);
  }

  return {
    roomName: body.room_name,
    organizerEmail: body.organizer_email,
    url: body.url,
  };
}
