import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventModal } from '../event-modal';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

// undust: Google Calendar and Outlook show invitees LOCATION and DESCRIPTION,
// never CONFERENCE (the virtual location). The editor copies the meeting link
// there on save - but only when the save changes something, so an event
// saved untouched sends its invitees no update, and only on the user's own
// events. (Togother meeting, 20/11/2026: invitees saw no link at all.)

vi.mock('../participant-availability', () => ({ ParticipantAvailability: () => null }));

const calendars = [{
  id: 'cal', name: 'Personal', color: '#123456', isDefault: true,
  myRights: {
    mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true,
    mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true,
  },
}] as unknown as Calendar[];

const OLD = 'https://meet.undust.co/m-old';
const NEW = 'https://meet.undust.co/m-new';

function attendee(address: string, owner: boolean) {
  return {
    '@type': 'Participant', calendarAddress: `mailto:${address}`, email: address,
    roles: owner ? { owner: true, attendee: true } : { attendee: true },
    participationStatus: owner ? 'accepted' : 'needs-action', scheduleAgent: 'server', expectReply: !owner, kind: 'individual',
  };
}

function meeting(organizer: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1', uid: 'u1', '@type': 'Event', title: 'Besoins', description: '', start: '2026-11-20T09:30:00',
    duration: 'PT1H', timeZone: 'Europe/Paris', showWithoutTime: false, calendarIds: { cal: true },
    organizerCalendarAddress: `mailto:${organizer}`,
    participants: { a: attendee(organizer, true), b: attendee('guest@example.org', false) },
    virtualLocations: { vl1: { '@type': 'VirtualLocation', uri: OLD, name: null, description: null, features: null } },
    locations: null, alerts: null, recurrenceRules: null,
    ...extra,
  } as unknown as CalendarEvent;
}

async function editAndSave(event: CalendarEvent, change?: () => void): Promise<Partial<CalendarEvent>> {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <EventModal event={event} calendars={calendars} onSave={onSave} onClose={vi.fn()} currentUserEmails={['me@example.com']} />,
  );
  fireEvent.click(screen.getByText('events.edit'));
  change?.();
  fireEvent.click(screen.getByText('form.save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave.mock.calls[0][0] as Partial<CalendarEvent>;
}

const link = () => screen.getByPlaceholderText('https://meet.example.com/...') as HTMLInputElement;
const titleField = () => screen.getByDisplayValue('Besoins') as HTMLInputElement;

afterEach(() => cleanup());

describe('EventModal meeting link in location and description', () => {
  it('adds nothing to an own event saved untouched', async () => {
    const data = await editAndSave(meeting('me@example.com'));
    expect(data.locations ?? null).toBeNull();
    expect(data.description ?? '').not.toContain(OLD);
  });

  it('completes an own event when the save changes something anyway', async () => {
    const data = await editAndSave(meeting('me@example.com'), () => {
      fireEvent.change(titleField(), { target: { value: 'Besoins - IA' } });
    });
    expect(Object.values(data.locations!)[0].name).toBe(OLD);
    expect(data.description).toBe(`form.meeting_link_description_label ${OLD}`);
  });

  it('replaces the previous link where it was copied when the link changes', async () => {
    const event = meeting('me@example.com', {
      locations: { loc1: { '@type': 'Location', name: OLD } } as unknown as CalendarEvent['locations'],
      description: `Ordre du jour\n\nform.meeting_link_description_label ${OLD}`,
    });
    const data = await editAndSave(event, () => {
      fireEvent.change(link(), { target: { value: NEW } });
    });
    expect(Object.values(data.locations!)[0].name).toBe(NEW);
    expect(data.description).toBe(`Ordre du jour\n\nform.meeting_link_description_label ${NEW}`);
  });

  it('keeps a location the user typed when the link changes', async () => {
    const event = meeting('me@example.com', {
      locations: { loc1: { '@type': 'Location', name: '12 rue de la Paix' } } as unknown as CalendarEvent['locations'],
    });
    const data = await editAndSave(event, () => {
      fireEvent.change(link(), { target: { value: NEW } });
    });
    expect(Object.values(data.locations!)[0].name).toBe('12 rue de la Paix');
    expect(data.description).toBe(`form.meeting_link_description_label ${NEW}`);
  });

  it('never rewrites the location or description of someone else\'s invitation', async () => {
    const data = await editAndSave(meeting('boss@example.org'), () => {
      fireEvent.change(titleField(), { target: { value: 'Besoins - IA' } });
    });
    expect(data.locations ?? null).toBeNull();
    expect(data.description ?? '').not.toContain(OLD);
  });
});
