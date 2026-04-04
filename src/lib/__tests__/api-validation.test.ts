import { describe, it, expect } from 'vitest';
import {
  SubmitEventSchema,
  ToggleFeaturedSchema,
  AdminConfigSchema,
  GeocodeSchema,
  LumaSchema,
  FetchEventSchema,
  ABTrackEventSchema,
} from '../api-validation';

describe('SubmitEventSchema', () => {
  it('accepts valid submission with all fields', () => {
    const result = SubmitEventSchema.safeParse({
      conference: 'PBW 2026',
      coords: { lat: 48.8566, lng: 2.3522 },
      event: {
        name: 'Test Event',
        date: 'Sat, Apr 11',
        startTime: '9:00a',
        endTime: '5:00p',
        organizer: 'Test Org',
        address: '123 Test St',
        cost: 'Free',
        tags: 'Conference, ETH',
        link: 'https://example.com',
        food: true,
        bar: false,
        note: 'A note',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal valid submission (only required fields)', () => {
    const result = SubmitEventSchema.safeParse({
      conference: 'PBW 2026',
      event: {
        name: 'Test Event',
        date: 'Sat, Apr 11',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing conference', () => {
    const result = SubmitEventSchema.safeParse({
      event: {
        name: 'Test Event',
        date: 'Sat, Apr 11',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty conference string', () => {
    const result = SubmitEventSchema.safeParse({
      conference: '',
      event: {
        name: 'Test Event',
        date: 'Sat, Apr 11',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing event name', () => {
    const result = SubmitEventSchema.safeParse({
      conference: 'PBW 2026',
      event: {
        date: 'Sat, Apr 11',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing event date', () => {
    const result = SubmitEventSchema.safeParse({
      conference: 'PBW 2026',
      event: {
        name: 'Test Event',
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts null coords', () => {
    const result = SubmitEventSchema.safeParse({
      conference: 'PBW 2026',
      coords: null,
      event: {
        name: 'Test Event',
        date: 'Sat, Apr 11',
      },
    });
    expect(result.success).toBe(true);
  });

  it('defaults optional event fields', () => {
    const result = SubmitEventSchema.safeParse({
      conference: 'PBW 2026',
      event: {
        name: 'Test Event',
        date: 'Sat, Apr 11',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.event.startTime).toBe('');
      expect(result.data.event.cost).toBe('Free');
      expect(result.data.event.food).toBe(false);
      expect(result.data.event.bar).toBe(false);
    }
  });
});

describe('ToggleFeaturedSchema', () => {
  it('accepts valid input', () => {
    const result = ToggleFeaturedSchema.safeParse({
      password: 'secret',
      conference: 'PBW 2026',
      eventName: 'Test Event',
      featured: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing password', () => {
    const result = ToggleFeaturedSchema.safeParse({
      conference: 'PBW 2026',
      eventName: 'Test Event',
      featured: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean featured', () => {
    const result = ToggleFeaturedSchema.safeParse({
      password: 'secret',
      conference: 'PBW 2026',
      eventName: 'Test Event',
      featured: 'yes',
    });
    expect(result.success).toBe(false);
  });
});

describe('AdminConfigSchema', () => {
  it('accepts valid input', () => {
    const result = AdminConfigSchema.safeParse({
      password: 'secret',
      key: 'sponsors',
      value: [{ text: 'hello' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty key', () => {
    const result = AdminConfigSchema.safeParse({
      password: 'secret',
      key: '',
      value: 'anything',
    });
    expect(result.success).toBe(false);
  });

  it('accepts any value type (z.unknown)', () => {
    const result1 = AdminConfigSchema.safeParse({ password: 'p', key: 'k', value: 42 });
    const result2 = AdminConfigSchema.safeParse({ password: 'p', key: 'k', value: null });
    const result3 = AdminConfigSchema.safeParse({ password: 'p', key: 'k', value: { nested: true } });
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result3.success).toBe(true);
  });
});

describe('GeocodeSchema', () => {
  it('accepts valid address array', () => {
    const result = GeocodeSchema.safeParse({
      addresses: [
        { normalized: '123 main st', raw: '123 Main St', conference: 'PBW 2026' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty addresses array', () => {
    const result = GeocodeSchema.safeParse({ addresses: [] });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields in address objects', () => {
    const result = GeocodeSchema.safeParse({
      addresses: [{ normalized: '123 main st' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('LumaSchema', () => {
  it('accepts valid URL', () => {
    const result = LumaSchema.safeParse({ url: 'https://lu.ma/event-123' });
    expect(result.success).toBe(true);
  });

  it('rejects empty URL', () => {
    const result = LumaSchema.safeParse({ url: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing url field', () => {
    const result = LumaSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('FetchEventSchema', () => {
  it('accepts valid URL', () => {
    const result = FetchEventSchema.safeParse({ url: 'https://example.com/event' });
    expect(result.success).toBe(true);
  });

  it('rejects empty URL', () => {
    const result = FetchEventSchema.safeParse({ url: '' });
    expect(result.success).toBe(false);
  });
});

describe('ABTrackEventSchema', () => {
  it('accepts valid track event', () => {
    const result = ABTrackEventSchema.safeParse({
      test_id: 'test-1',
      variant_id: 'control',
      visitor_id: 'v-abc',
      event_type: 'impression',
    });
    expect(result.success).toBe(true);
  });

  it('accepts track event with metadata', () => {
    const result = ABTrackEventSchema.safeParse({
      test_id: 'test-1',
      variant_id: 'control',
      visitor_id: 'v-abc',
      event_type: 'click',
      metadata: { page: 'home', position: 'top' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid event_type', () => {
    const result = ABTrackEventSchema.safeParse({
      test_id: 'test-1',
      variant_id: 'control',
      visitor_id: 'v-abc',
      event_type: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid event types', () => {
    for (const type of ['impression', 'click', 'conversion']) {
      const result = ABTrackEventSchema.safeParse({
        test_id: 'test-1',
        variant_id: 'control',
        visitor_id: 'v-abc',
        event_type: type,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects missing required fields', () => {
    const result = ABTrackEventSchema.safeParse({
      test_id: 'test-1',
      // missing variant_id, visitor_id, event_type
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty test_id', () => {
    const result = ABTrackEventSchema.safeParse({
      test_id: '',
      variant_id: 'control',
      visitor_id: 'v-abc',
      event_type: 'impression',
    });
    expect(result.success).toBe(false);
  });
});
