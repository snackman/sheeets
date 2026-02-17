# Project Status
*Last updated: 2026-02-16 (Session 10)*

## Open PRs
| PR | Branch | Feature | Preview | Status |
|----|--------|---------|---------|--------|
| #40 | `luma-rsvp-v2` | Luma RSVP: in-page checkout + copy-paste fields | [Preview](https://sheeets-git-luma-rsvp-v2-pizza-dao.vercel.app) | ✓ Ready for review |
| #41 | `geocode-api` | Runtime geocode API (fixes missing map pins) | [Preview](https://sheeets-git-geocode-api-pizza-dao.vercel.app) | ✓ Ready for review |
| #39 | `api-docs-page` | API documentation page | [Preview](https://sheeets-git-api-docs-page-pizza-dao.vercel.app/api) | ✓ Ready for review |
| #34 | `agent-api` | Agent API: Foundation + Events | - | Edge fn live v4. Safe to merge. |
| #30 | `luma-rsvp` | Old Luma RSVP (superseded by #40) | - | Close — replaced by #40 |

## Just Pushed to Master
- `1644a59` fix: POI address tap opens navigation drawer on mobile
- Geocode script ran — 11 new addresses cached (goes live via PR #41)

## Active Worktrees
| Worktree | Branch | PR |
|----------|--------|----|
| `sheeets-luma-rsvp` | `luma-rsvp-v2` | #40 |
| `sheeets-geocode-api` | `geocode-api` | #41 |
| `sheeets-api-docs` | `api-docs-page` | #39 |
| `sheeets-agent-api` | `agent-api` | #34 |

## Open Plans
- `plans/luma-rsvp.md` — Implemented in #40
- `plans/tomato-46571-theme-toggle.md` — Theme toggle

## Edge Functions (Deployed)
| Function | Version | Status |
|----------|---------|--------|
| `agent-api` | v4 | ✓ Live |
| `resolve-luma-event` | v4 | ✓ Live |
| `luma-rsvp` | v3 | ✓ Live (not needed with new approach) |

## Cleanup Needed
- Close PR #30 (superseded by #40)
- Delete `test-luma-rsvp` and `luma-rsvp` edge functions (no longer needed with embed widget approach)
- Delete `luma_events` Supabase table (not needed)
