/**
 * Luma registration submission — posts to the Luma event/register endpoint.
 *
 * Requires a Cloudflare Turnstile token header (x-luma-turnstile-token).
 * Without a valid token, the Luma API returns auth/additional-verification-required.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistrationAnswer {
  question_id: string;
  value: string | string[] | boolean | { company: string | null; job_title: string | null } | null;
  label: string;
  question_type: string;
}

export interface RegistrationPayload {
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  event_api_id: string;
  registration_answers: RegistrationAnswer[];
  phone_number?: string;
  turnstile_token: string;
}

export interface RegistrationResult {
  success: boolean;
  error?: string;
  code?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}

// ---------------------------------------------------------------------------
// Submit a registration to Luma
// ---------------------------------------------------------------------------

export async function submitLumaRegistration(
  payload: RegistrationPayload
): Promise<RegistrationResult> {
  try {
    const body = {
      name: payload.name,
      first_name: payload.first_name,
      last_name: payload.last_name,
      email: payload.email,
      event_api_id: payload.event_api_id,
      registration_answers: payload.registration_answers,
      phone_number: payload.phone_number || null,
      for_waitlist: false,
      expected_amount_cents: 0,
      expected_amount_tax: 0,
      currency: 'usd',
      opened_from: 'embed',
      payment_method: null,
      payment_currency: null,
      coupon_code: null,
      token_gate_info: null,
      eth_address_info: null,
      solana_address_info: null,
      ticket_type_to_selection: {},
    };

    const res = await fetch('https://api.lu.ma/event/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-luma-turnstile-token': payload.turnstile_token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        error: data.message || data.error || `HTTP ${res.status}`,
        code: data.code || undefined,
        data,
      };
    }

    return { success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
