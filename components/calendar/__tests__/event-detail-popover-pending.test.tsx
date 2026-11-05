import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventDetailPopover } from '../event-detail-popover';
import type { Calendar, CalendarEvent, CalendarParticipant } from '@/lib/jmap/types';

// The popover says "awaiting your reply" above the user's own RSVP bar, the
// same cue the hatched block gives in the calendar views (LPBvKUOr §3).

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
  useFormatter: () => ({ dateTime: (d: Date | string) => String(d), relativeTime: (d: Date | string) => String(d), number: (n: number) => String(n) }),
}));

const calendar = { id: 'cal-1', name: 'Work', myRights: { mayWriteAll: true, mayWriteOwn: true, mayRSVP: true } } as unknown as Calendar;

function renderPopover(myStatus: CalendarParticipant['participationStatus']) {
  const event = {
    id: 'evt-1', uid: 'uid-1', calendarIds: { 'cal-1': true }, title: 'Review', start: '2026-11-20T10:00:00', duration: 'PT1H',
    timeZone: 'Europe/Paris', showWithoutTime: false, alerts: null, useDefaultAlerts: false, status: 'confirmed',
    participants: {
      org: { '@type': 'Participant', calendarAddress: 'mailto:boss@example.com', roles: { owner: true }, participationStatus: 'accepted' },
      me: { '@type': 'Participant', calendarAddress: 'mailto:me@example.com', roles: { attendee: true }, participationStatus: myStatus },
    },
  } as unknown as CalendarEvent;
  render(
    <EventDetailPopover event={event} calendar={calendar} anchorRect={new DOMRect(100, 100, 50, 20)}
      onEdit={vi.fn()} onDelete={vi.fn()} onDuplicate={vi.fn()} onClose={vi.fn()} onSaveNote={vi.fn()}
      onRsvp={vi.fn()} currentUserEmails={['me@example.com']} />,
  );
}

describe('pending RSVP notice in the event popover', () => {
  it('shows above the RSVP bar while the invitation awaits a reply', () => {
    renderPopover('needs-action');
    expect(screen.getByTestId('answer-self')).toBeTruthy();
    expect(screen.getByTestId('pending-notice').textContent).toBe('participants.pending_badge');
  });

  it('is gone once the user has accepted', () => {
    renderPopover('accepted');
    expect(screen.getByTestId('answer-self')).toBeTruthy();
    expect(screen.queryByTestId('pending-notice')).toBeNull();
  });
});
