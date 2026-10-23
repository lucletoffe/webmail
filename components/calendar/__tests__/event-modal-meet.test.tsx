import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { EventModal } from '../event-modal';
import { isUndustMeetEnabled } from '@/lib/undust-meet';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

// Same rule as the detail popover (decision GNgpgt03), on the read-only view
// the event modal opens with (side panel on desktop, full screen on phones).

const GUEST_LINK = 'https://meet.undust.co/m-ee59ee19aad5be55';
const HOST_LINK = 'https://ops.undust.co/meet/m-ee59ee19aad5be55?host=1';
// What Ops writes in the events it creates (JMAP luc@, 23/10).
const OPS_DESCRIPTION = `Lien visio : ${GUEST_LINK}\nQuand : lundi 23 novembre 2026, 15h00 – 15h45 (heure de Paris)`;

const calendars = [{
  id: 'cal1',
  name: 'Undust',
  color: '#123456',
  myRights: { mayReadItems: true, mayWriteAll: true, mayWriteOwn: true, mayUpdatePrivate: true, mayRSVP: true, mayDelete: true },
}] as unknown as Calendar[];

// Loose on purpose: tests spell out only the fields the link logic reads.
function makeEvent(overrides: Record<string, unknown>): CalendarEvent {
  return {
    '@type': 'Event',
    id: 'ev1',
    uid: 'uid-ev1',
    title: 'PCM Technologie - Potentiel IA',
    start: '2026-11-23T15:00:00',
    duration: 'PT45M',
    showWithoutTime: false,
    calendarIds: { cal1: true },
    participants: {
      luc: { roles: { owner: true }, email: 'luc@undust.co', calendarAddress: 'mailto:luc@undust.co' },
      client: { email: 'pb@b-technologie.fr', calendarAddress: 'mailto:pb@b-technologie.fr' },
    },
    ...overrides,
  } as unknown as CalendarEvent;
}

const opsEvent = makeEvent({
  locations: { loc1: { '@type': 'Location', name: GUEST_LINK } },
  description: OPS_DESCRIPTION,
});

function renderModal(event: CalendarEvent) {
  return render(
    <EventModal
      event={event}
      calendars={calendars}
      onSave={vi.fn()}
      onClose={vi.fn()}
      currentUserEmails={['luc@undust.co']}
    />
  );
}

describe('EventModal view undust meeting link', () => {
  beforeAll(() => {
    // jsdom runs on localhost, which the undust guard accepts like
    // webmail.undust.co; without it every case below would test nothing.
    expect(isUndustMeetEnabled()).toBe(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the organizer link from a location created by Ops', () => {
    renderModal(opsEvent);

    const link = screen.getByTitle(GUEST_LINK);
    expect(link.getAttribute('href')).toBe(HOST_LINK);
    expect(link.textContent).toBe('meet.undust.co');
  });

  it('opens the organizer link from the description written by Ops', () => {
    renderModal(opsEvent);

    expect(screen.getByText(GUEST_LINK).getAttribute('href')).toBe(HOST_LINK);
  });

  it('opens the organizer link from the virtual location', () => {
    renderModal(makeEvent({
      virtualLocations: { vl1: { '@type': 'VirtualLocation', uri: GUEST_LINK } },
    }));

    expect(screen.getByTitle(GUEST_LINK).getAttribute('href')).toBe(HOST_LINK);
  });
});
