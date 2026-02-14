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
    const { event_id, luma_slug } = await req.json();

    if (!event_id || !luma_slug) {
      return new Response(
        JSON.stringify({ error: "event_id and luma_slug are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check cache first
    const { data: cached } = await supabase
      .from("luma_events")
      .select("luma_api_id, luma_ticket_type_id, is_free, requires_approval")
      .eq("event_id", event_id)
      .maybeSingle();

    if (cached?.luma_api_id) {
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve via Luma API
    const lumaRes = await fetch(
      `https://api.lu.ma/url?url=${encodeURIComponent(luma_slug)}`
    );

    if (!lumaRes.ok) {
      return new Response(
        JSON.stringify({
          error: "Failed to resolve Luma event",
          status: lumaRes.status,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const lumaData = await lumaRes.json();

    // Extract event data from Luma response
    const lumaApiId = lumaData?.data?.api_id || lumaData?.api_id || null;
    const eventData =
      lumaData?.data?.event || lumaData?.event || lumaData?.data || {};
    const ticketInfo =
      lumaData?.data?.ticket_info || eventData?.ticket_info || {};
    const ticketTypes = ticketInfo?.ticket_types || [];
    const firstTicketType = ticketTypes.length > 0 ? ticketTypes[0] : null;
    const lumaTicketTypeId = firstTicketType?.api_id || null;
    const isFree = firstTicketType
      ? firstTicketType.price === 0 ||
        firstTicketType.price === null ||
        firstTicketType.is_free === true
      : true;
    const requiresApproval =
      eventData?.requires_approval ||
      ticketInfo?.requires_approval ||
      false;
    const lumaEventName = eventData?.name || null;

    // Cache the result
    await supabase.from("luma_events").upsert(
      {
        event_id,
        luma_slug,
        luma_api_id: lumaApiId,
        luma_ticket_type_id: lumaTicketTypeId,
        luma_event_name: lumaEventName,
        is_free: isFree,
        requires_approval: requiresApproval,
        resolved_at: new Date().toISOString(),
      },
      { onConflict: "event_id" }
    );

    const result = {
      luma_api_id: lumaApiId,
      luma_ticket_type_id: lumaTicketTypeId,
      is_free: isFree,
      requires_approval: requiresApproval,
    };

    return new Response(JSON.stringify(result), {
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
