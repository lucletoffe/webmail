import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventDetailPopover } from '../event-detail-popover';
import type { CalendarEvent } from '@/lib/jmap/types';

// The organizer of an undust room joins it through Ops as moderator
// (decision GNgpgt03): the popover link opens the organizer URL while the
// text keeps showing the guest link. jsdom runs on localhost, which the
// undust guard accepts.

const GUEST_LINK = 'https://meet.undust.co/m-ee59ee19aad5be55';
const HOST_LINK = 'https://ops.undust.co/meet/m-ee59ee19aad5be55?host=1';

const luc = { roles: { owner: true }, email: 'luc@undust.co', calendarAddress: 'mailto:luc@undust.co' };
const client = { email: 'pb@b-technologie.fr', calendarAddress: 'mailto:pb@b-technologie.fr' };

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
    participants: { luc, client },
    ...overrides,
  } as unknown as CalendarEvent;
}

function renderPopover(event: CalendarEvent, currentUserEmails = ['luc@undust.co']) {
  return render(
    <EventDetailPopover
      event={event}
      anchorRect={new DOMRect(100, 100, 50, 20)}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
      onClose={vi.fn()}
      onSaveNote={vi.fn()}
      currentUserEmails={currentUserEmails}
    />
  );
}

describe('EventDetailPopover undust meeting link', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens the organizer link from a location created by Ops', () => {
    renderPopover(makeEvent({ locations: { loc1: { '@type': 'Location', name: GUEST_LINK } } }));

    const link = screen.getByTitle(GUEST_LINK);
    expect(link.getAttribute('href')).toBe(HOST_LINK);
    expect(link.textContent).toBe('meet.undust.co');
  });

  it('opens the organizer link from the virtual location', () => {
    renderPopover(makeEvent({
      virtualLocations: { vl1: { '@type': 'VirtualLocation', uri: GUEST_LINK } },
    }));

    expect(screen.getByTitle(GUEST_LINK).getAttribute('href')).toBe(HOST_LINK);
  });

  it('keeps the guest link for a guest', () => {
    renderPopover(
      makeEvent({ locations: { loc1: { '@type': 'Location', name: GUEST_LINK } } }),
      ['pb@b-technologie.fr']
    );

    expect(screen.getByTitle(GUEST_LINK).getAttribute('href')).toBe(GUEST_LINK);
  });

  it('leaves other meeting links alone', () => {
    const zoom = 'https://zoom.us/j/123456';
    renderPopover(makeEvent({
      virtualLocations: { vl1: { '@type': 'VirtualLocation', uri: zoom } },
    }));

    expect(screen.getByTitle(zoom).getAttribute('href')).toBe(zoom);
  });
});
