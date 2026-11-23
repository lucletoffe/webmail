/**
 * undust: copy the meeting link into the fields every calendar shows.
 *
 * The editor's meeting link is saved as a JSCalendar virtual location, which
 * Stalwart sends as the iCalendar CONFERENCE property (RFC 7986). Google
 * Calendar and Outlook do not show CONFERENCE on an invitation from outside:
 * they show LOCATION and DESCRIPTION only, so an invitee there gets no link
 * at all (Togother meeting, 20/11/2026). The link is therefore also written
 * as the location, when the event has none, and at the end of the
 * description, unless the description already holds it.
 *
 * Idempotent: applying it twice changes nothing more; a location the user
 * typed is never replaced.
 */
export interface MeetingLinkFields {
  location: string;
  description: string;
}

export function withMeetingLinkFallback(
  fields: MeetingLinkFields,
  link: string | null | undefined,
  label: string,
): MeetingLinkFields {
  const uri = (link ?? '').trim();
  if (!uri) return fields;

  const location = fields.location.trim() ? fields.location : uri;

  let description = fields.description;
  if (!description.includes(uri)) {
    const line = `${label.trim()} ${uri}`;
    const body = description.replace(/\s+$/, '');
    description = body ? `${body}\n\n${line}` : line;
  }

  return { location, description };
}
