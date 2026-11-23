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
 * A link the event carried before (`previousLinks`) is replaced where it was
 * copied: a location equal to it takes the new link, its own line in the
 * description is dropped and any other mention is rewritten, so an invitee
 * never sees a stale room. Removing the meeting link removes those copies.
 *
 * Idempotent: applying it twice changes nothing more; a location the user
 * typed is never replaced.
 */
export interface MeetingLinkFields {
  location: string;
  description: string;
}

export interface MeetingLinkOptions {
  /** Links the event or this form carried before, to be replaced. */
  previousLinks?: ReadonlyArray<string | null | undefined>;
  /** Every label a copied line may start with (both variants, all languages in use). */
  knownLabels?: ReadonlyArray<string>;
}

export function withMeetingLinkFallback(
  fields: MeetingLinkFields,
  link: string | null | undefined,
  label: string,
  options: MeetingLinkOptions = {},
): MeetingLinkFields {
  const uri = (link ?? '').trim();
  const previous = [...new Set((options.previousLinks ?? []).map((l) => (l ?? '').trim()))]
    .filter((l) => l && l !== uri);
  if (!uri && previous.length === 0) return fields;

  const labels = [...new Set([label, ...(options.knownLabels ?? [])].map((l) => l.trim()).filter(Boolean))];
  let location = fields.location;
  let description = fields.description;

  for (const old of previous) {
    if (location.trim() === old) location = uri;
    if (description.includes(old)) {
      const lines = description.split('\n');
      const kept = lines.filter((line) => !labels.some((l) => line.trim() === `${l} ${old}`));
      description = kept.length === lines.length
        ? description
        : kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
      // Only the old link itself, not the start of a longer one.
      if (uri) description = description.replace(new RegExp(`${escapeRegExp(old)}(?![^\\s<>"'])`, 'g'), () => uri);
    }
  }

  if (!uri) return { location, description };

  if (!location.trim()) location = uri;
  if (!description.includes(uri)) {
    const line = `${label.trim()} ${uri}`;
    const body = description.replace(/\s+$/, '');
    description = body ? `${body}\n\n${line}` : line;
  }

  return { location, description };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `link` is an undust visio room (meet.undust.co): only those open in
 * the browser with no account or app, which the longer label promises.
 */
export function isUndustMeetLink(link: string | null | undefined): boolean {
  try {
    const url = new URL((link ?? '').trim());
    return url.protocol === 'https:' && url.hostname === 'meet.undust.co';
  } catch {
    return false;
  }
}
