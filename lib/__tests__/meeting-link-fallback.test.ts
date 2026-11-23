import { describe, expect, it } from 'vitest';
import { isUndustMeetLink, withMeetingLinkFallback } from '../meeting-link-fallback';

const LINK = 'https://meet.undust.co/m-87d53d5c1664dfd4';
const LABEL = 'Visio (navigateur, sans compte ni appli) :';

describe('withMeetingLinkFallback', () => {
  it('fills an empty location and an empty description with the link', () => {
    expect(withMeetingLinkFallback({ location: '', description: '' }, LINK, LABEL)).toEqual({
      location: LINK,
      description: `${LABEL} ${LINK}`,
    });
  });

  it('keeps a location the user typed and appends the link under the description', () => {
    expect(withMeetingLinkFallback({ location: '12 rue de la Paix', description: 'Ordre du jour\n' }, LINK, LABEL)).toEqual({
      location: '12 rue de la Paix',
      description: `Ordre du jour\n\n${LABEL} ${LINK}`,
    });
  });

  it('does not add the link to a description that already holds it', () => {
    const description = `Rejoindre : ${LINK}`;
    expect(withMeetingLinkFallback({ location: '', description }, LINK, LABEL).description).toBe(description);
  });

  it('is idempotent', () => {
    const once = withMeetingLinkFallback({ location: '', description: 'Notes' }, LINK, LABEL);
    expect(withMeetingLinkFallback(once, LINK, LABEL)).toEqual(once);
  });

  it('changes nothing without a link', () => {
    const fields = { location: '', description: 'Notes' };
    expect(withMeetingLinkFallback(fields, '', LABEL)).toBe(fields);
    expect(withMeetingLinkFallback(fields, '   ', LABEL)).toBe(fields);
    expect(withMeetingLinkFallback(fields, null, LABEL)).toBe(fields);
  });

  it('trims the link it writes', () => {
    expect(withMeetingLinkFallback({ location: '', description: '' }, `  ${LINK} `, LABEL).location).toBe(LINK);
  });
});

describe('isUndustMeetLink', () => {
  it('recognises an undust room only', () => {
    expect(isUndustMeetLink(LINK)).toBe(true);
    expect(isUndustMeetLink(` ${LINK} `)).toBe(true);
    expect(isUndustMeetLink('https://zoom.us/j/123')).toBe(false);
    expect(isUndustMeetLink('https://meet.undust.co.evil.example/x')).toBe(false);
    expect(isUndustMeetLink('http://meet.undust.co/x')).toBe(false);
    expect(isUndustMeetLink('not a url')).toBe(false);
    expect(isUndustMeetLink(null)).toBe(false);
  });
});

describe('withMeetingLinkFallback with a previous link', () => {
  const OLD = 'https://meet.undust.co/m-old';
  const NEW = 'https://meet.undust.co/m-new';
  const SHORT = 'Visio :';
  const opts = { previousLinks: [OLD], knownLabels: [LABEL, SHORT] };

  it('replaces the copied location and line', () => {
    expect(withMeetingLinkFallback({ location: OLD, description: `Notes\n\n${LABEL} ${OLD}` }, NEW, LABEL, opts)).toEqual({
      location: NEW,
      description: `Notes\n\n${LABEL} ${NEW}`,
    });
  });

  it('replaces a line written with the other label, under the label that fits the new link', () => {
    expect(withMeetingLinkFallback({ location: OLD, description: `${SHORT} ${OLD}` }, NEW, LABEL, opts)).toEqual({
      location: NEW,
      description: `${LABEL} ${NEW}`,
    });
  });

  it('rewrites the old link where the user mentioned it', () => {
    expect(withMeetingLinkFallback({ location: '', description: `Salle : ${OLD} (code 12)` }, NEW, LABEL, opts).description)
      .toBe(`Salle : ${NEW} (code 12)`);
  });

  it('keeps a typed location', () => {
    expect(withMeetingLinkFallback({ location: 'Bureau', description: '' }, NEW, LABEL, opts).location).toBe('Bureau');
  });

  it('takes the copies out when the link is removed', () => {
    expect(withMeetingLinkFallback({ location: OLD, description: `Notes\n\n${LABEL} ${OLD}` }, '', LABEL, opts)).toEqual({
      location: '',
      description: 'Notes',
    });
  });

  it('is idempotent after a replacement', () => {
    const once = withMeetingLinkFallback({ location: OLD, description: `${LABEL} ${OLD}` }, NEW, LABEL, opts);
    expect(withMeetingLinkFallback(once, NEW, LABEL, opts)).toEqual(once);
  });

  it('ignores a previous link equal to the current one', () => {
    const fields = { location: NEW, description: `${LABEL} ${NEW}` };
    expect(withMeetingLinkFallback(fields, NEW, LABEL, { previousLinks: [NEW] })).toEqual(fields);
  });
});

describe('withMeetingLinkFallback does not cut into a longer link', () => {
  it('leaves a longer link that starts with the old one', () => {
    const OLD = 'https://zoom.us/j/123';
    const NEW = 'https://zoom.us/j/123?pwd=x';
    expect(withMeetingLinkFallback({ location: '', description: `Rejoindre : ${NEW}` }, NEW, 'Visio :', { previousLinks: [OLD] }).description)
      .toBe(`Rejoindre : ${NEW}`);
    expect(withMeetingLinkFallback({ location: '', description: `Salle ${OLD}2 puis ${OLD} demain` }, 'https://zoom.us/j/9', 'Visio :', { previousLinks: [OLD] }).description)
      .toBe(`Salle ${OLD}2 puis https://zoom.us/j/9 demain`);
  });
});

describe('withMeetingLinkFallback replaces an old link followed by punctuation', () => {
  it('replaces it before a closing punctuation, not inside a longer link', () => {
    const OLD = 'https://meet.undust.co/m-old';
    const NEW = 'https://meet.undust.co/m-new';
    const opts = { previousLinks: [OLD] };
    expect(withMeetingLinkFallback({ location: 'x', description: `Rejoindre ${OLD}. Merci` }, NEW, 'Visio :', opts).description)
      .toBe(`Rejoindre ${NEW}. Merci`);
    expect(withMeetingLinkFallback({ location: 'x', description: `Salle (${OLD})` }, NEW, 'Visio :', opts).description)
      .toBe(`Salle (${NEW})`);
    expect(withMeetingLinkFallback({ location: 'x', description: `Voir ${OLD}.html` }, NEW, 'Visio :', opts).description)
      .toBe(`Voir ${OLD}.html\n\nVisio : ${NEW}`);
  });
});
