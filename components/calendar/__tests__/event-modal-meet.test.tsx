import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventModal } from '../event-modal';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

// Same rule as the detail popover (decision GNgpgt03), on the read-only view
// the event modal opens with — the surface phones get.

const GUEST_LINK = 'https://meet.undust.co/m-ee59ee19aad5be55';
const HOST_LINK = 'https://ops.undust.co/meet/m-ee59ee19aad5be55?host=1';

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
  afterEach(() => {
    cleanup();
  });

  it('opens the organizer link from a location created by Ops', () => {
    renderModal(makeEvent({ locations: { loc1: { '@type': 'Location', name: GUEST_LINK } } }));

    const link = screen.getByTitle(GUEST_LINK);
    expect(link.getAttribute('href')).toBe(HOST_LINK);
    expect(link.textContent).toBe('meet.undust.co');
  });

  it('opens the organizer link from the virtual location', () => {
    renderModal(makeEvent({
      virtualLocations: { vl1: { '@type': 'VirtualLocation', uri: GUEST_LINK } },
    }));

    expect(screen.getByTitle(GUEST_LINK).getAttribute('href')).toBe(HOST_LINK);
  });
});
