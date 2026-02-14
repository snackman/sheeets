import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { event_id, luma_api_id, ticket_type_id, name, email } =
      await req.json();

    if (!event_id || !luma_api_id || !name || !email) {
      return new Response(
        JSON.stringify({
          error: "event_id, luma_api_id, name, and email are required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get user ID from auth header
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user from JWT
    const token = authHeader?.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Attempt Luma RSVP via their API
    const ticketSelection: Record<string, number> = {};
    if (ticket_type_id) {
      ticketSelection[ticket_type_id] = 1;
    }

    const lumaBody: Record<string, unknown> = {
      event_api_id: luma_api_id,
      name,
      email,
    };

    if (Object.keys(ticketSelection).length > 0) {
      lumaBody.ticket_type_to_selection = ticketSelection;
    }

    const lumaRes = await fetch(
      "https://api.lu.ma/event/independent/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lumaBody),
      }
    );

    if (!lumaRes.ok) {
      const errorText = await lumaRes.text().catch(() => "Unknown error");
      console.error("Luma RSVP failed:", lumaRes.status, errorText);

      return new Response(
        JSON.stringify({
          success: false,
          fallback_required: true,
          error: `Luma API returned ${lumaRes.status}`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Record successful RSVP in our database
    const { error: insertError } = await supabase.from("rsvps").upsert(
      {
        user_id: user.id,
        event_id,
        luma_api_id,
        status: "confirmed",
        method: "api",
      },
      { onConflict: "user_id,event_id" }
    );

    if (insertError) {
      console.error("Failed to record RSVP:", insertError);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
