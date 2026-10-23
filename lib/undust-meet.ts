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
//   - Réponse 201 (contrat v2, décision PG GNgpgt03) :
//     { room_name, organizer_email, url, host_url? }. `url` est le lien
//     INVITÉ `https://meet.undust.co/<salle>`, celui qu'on écrit dans
//     l'événement et que reçoit tout invité. `host_url` n'est pas lu : le
//     lien organisateur se dérive de la salle (`hostJoinUrl`), y compris
//     pour les événements créés ailleurs (Ops) ou avant le contrat v2.
//
// Rejoindre en organisateur : `https://ops.undust.co/meet/<salle>?host=1`
// fait entrer l'organisateur authentifié en modérateur (login Pocket ID sinon).
//
// Un fetch échoue silencieusement si la session Pocket ID est expirée ou si
// l'utilisateur n'est pas l'organizer : l'UI remonte une erreur utilisateur,
// pas de retry automatique (une boucle sur 403 est inutile).

import { isOrganizer } from "@/lib/calendar-participants";
import type { CalendarEvent } from "@/lib/jmap/types";

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

const GUEST_HOST = "meet.undust.co";
const ROOM_PATH = /^\/([a-z0-9][a-z0-9-]{0,63})\/?$/;
const OPS_MEET_URL = "https://ops.undust.co/meet/";

// Salle d'un lien invité `https://meet.undust.co/<salle>` (slash final
// toléré). Toute autre forme — requête (anciens liens `?jwt=`), fragment,
// sous-chemin, http — n'est pas un lien de salle : il s'ouvre tel quel.
function guestRoomOf(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.host !== GUEST_HOST) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return ROOM_PATH.exec(url.pathname)?.[1] ?? null;
}

/**
 * Lien organisateur d'une salle undust : `https://ops.undust.co/meet/<salle>?host=1`
 * quand `uri` est le lien invité d'une salle ET que l'utilisateur organise
 * l'événement (participant `roles.owner` ou adresse organisateur parmi
 * `userEmails`, sans casse ; un événement sans participants est le sien).
 * Null sinon : le lien s'ouvre tel quel. Ops reste juge du rôle modérateur.
 */
export function hostJoinUrl(
  uri: string,
  event: CalendarEvent,
  userEmails: string[]
): string | null {
  const room = guestRoomOf(uri);
  if (!room) return null;
  const hasParticipants = Object.keys(event.participants ?? {}).length > 0;
  if (hasParticipants && !isOrganizer(event, userEmails)) return null;
  return `${OPS_MEET_URL}${room}?host=1`;
}

/**
 * Ce qu'ouvre l'action « Rejoindre » d'un lien de réunion : le lien
 * organisateur sur l'instance undust (`hostJoinUrl`), le lien lui-même
 * partout ailleurs. Le texte affiché reste le lien invité.
 */
export function meetingJoinHref(
  uri: string,
  event: CalendarEvent,
  userEmails: string[]
): string {
  return (isUndustMeetEnabled() && hostJoinUrl(uri, event, userEmails)) || uri;
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
