/**
 * MCP tool definitions for the sheeets Agent API.
 *
 * Each tool maps 1:1 to a REST API endpoint. Tools that require
 * authentication are marked in their descriptions.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SheeetsAPI } from "./api.js";

/**
 * Register all sheeets tools on the given MCP server.
 */
export function registerTools(server: McpServer, api: SheeetsAPI): void {
  // ---------------------------------------------------------------------------
  // Events (public, no auth required)
  // ---------------------------------------------------------------------------

  server.tool(
    "search_events",
    "Search and filter crypto/web3 events. Returns matching events with full details. All parameters are optional filters.",
    {
      conference: z
        .string()
        .optional()
        .describe("Filter by conference name (e.g. 'ETH Denver 2026')"),
      date: z
        .string()
        .optional()
        .describe("Filter by date in ISO format (e.g. '2026-02-10')"),
      tags: z
        .string()
        .optional()
        .describe(
          "Comma-separated tags to filter by (e.g. 'DeFi,Networking')"
        ),
      search: z
        .string()
        .optional()
        .describe("Free-text search across event names, organizers, notes"),
      free: z
        .boolean()
        .optional()
        .describe("If true, only show free events"),
      now: z
        .boolean()
        .optional()
        .describe("If true, only show events happening right now"),
    },
    async (args) => {
      try {
        const result = await api.searchEvents({
          conference: args.conference,
          date: args.date,
          tags: args.tags,
          search: args.search,
          free: args.free,
          now: args.now,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching events: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_event",
    "Get full details for a specific event by its ID.",
    {
      eventId: z.string().describe("The event ID to look up"),
    },
    async (args) => {
      try {
        const result = await api.getEvent(args.eventId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting event: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_conferences",
    "List all available conferences with their event counts.",
    async () => {
      try {
        const result = await api.listConferences();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing conferences: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_tags",
    "List all event tags with their counts, sorted by popularity.",
    async () => {
      try {
        const result = await api.listTags();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing tags: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_dates",
    "List all event dates with their counts.",
    async () => {
      try {
        const result = await api.listDates();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing dates: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Itinerary (auth required)
  // ---------------------------------------------------------------------------

  server.tool(
    "get_itinerary",
    "Get the user's saved event itinerary with full event details. Requires SHEEETS_API_KEY.",
    async () => {
      try {
        const result = await api.getItinerary();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting itinerary: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "add_to_itinerary",
    "Add one or more events to the user's itinerary. Requires SHEEETS_API_KEY.",
    {
      eventIds: z
        .array(z.string())
        .min(1)
        .describe("Array of event IDs to add to the itinerary"),
    },
    async (args) => {
      try {
        const result = await api.addToItinerary(args.eventIds);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error adding to itinerary: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "remove_from_itinerary",
    "Remove one or more events from the user's itinerary. Requires SHEEETS_API_KEY.",
    {
      eventIds: z
        .array(z.string())
        .min(1)
        .describe("Array of event IDs to remove from the itinerary"),
    },
    async (args) => {
      try {
        const result = await api.removeFromItinerary(args.eventIds);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error removing from itinerary: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Friends (auth required, read-only)
  // ---------------------------------------------------------------------------

  server.tool(
    "get_friends",
    "List the user's friends. Requires SHEEETS_API_KEY.",
    async () => {
      try {
        const result = await api.getFriends();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting friends: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "friends_going",
    "See which friends are going to events. Optionally filter by a specific event. Requires SHEEETS_API_KEY.",
    {
      eventId: z
        .string()
        .optional()
        .describe("Optional event ID to filter which friends are attending"),
    },
    async (args) => {
      try {
        const result = await api.friendsGoing(args.eventId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting friends going: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // RSVPs (auth required)
  // ---------------------------------------------------------------------------

  server.tool(
    "list_rsvps",
    "List the user's event RSVPs. Requires SHEEETS_API_KEY.",
    async () => {
      try {
        const result = await api.listRsvps();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing RSVPs: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "rsvp_event",
    "RSVP to an event (registers attendance via Luma). Requires SHEEETS_API_KEY.",
    {
      eventId: z.string().describe("The event ID to RSVP to"),
    },
    async (args) => {
      try {
        const result = await api.rsvpEvent(args.eventId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error RSVPing to event: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Recommendations (auth required)
  // ---------------------------------------------------------------------------

  server.tool(
    "get_recommendations",
    "Get personalized event recommendations based on the user's itinerary and friends. Requires SHEEETS_API_KEY.",
    async () => {
      try {
        const result = await api.getRecommendations();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting recommendations: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
