/**
 * Google Calendar helpers.
 *
 * Thin wrappers over the Google Calendar REST API used by the appointment
 * scheduler to (a) read the owner's busy times so we never offer a slot that
 * collides with something already on their calendar, and (b) write a calendar
 * event when an appointment is booked.
 *
 * These take a valid access token (obtained via
 * googleController.getValidAccessToken) and surface upstream failures as tagged
 * googleError errors so callers can map them to a 502, consistent with the rest
 * of the Google integration.
 */

const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";
const EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** True when the granted scope string includes calendar write access. */
function hasCalendarScope(scope) {
  return typeof scope === "string" && scope.includes(CALENDAR_SCOPE);
}

async function googleCalendarFetch(url, accessToken, options, errorLabel) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options && options.headers),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg =
      data.error?.message ||
      data.error_description ||
      `${errorLabel} failed (HTTP ${res.status})`;
    const err = new Error(msg);
    err.googleError = true;
    throw err;
  }
  return data;
}

/**
 * Returns the owner's busy intervals between timeMin and timeMax (ISO strings)
 * as an array of { start, end } ISO ranges from their primary calendar.
 */
async function listBusyTimes(accessToken, timeMin, timeMax) {
  const data = await googleCalendarFetch(
    FREEBUSY_ENDPOINT,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: "primary" }],
      }),
    },
    "Google Calendar free/busy",
  );
  const calendars = data.calendars || {};
  const primary = calendars.primary || {};
  return Array.isArray(primary.busy) ? primary.busy : [];
}

/**
 * Creates an event on the owner's primary calendar. Returns the created event id.
 * timeZone is an IANA tz string (the brand's configured timezone).
 */
async function createEvent(accessToken, event) {
  const {
    summary,
    description,
    location,
    startIso,
    endIso,
    timeZone,
    attendeeEmails = [],
  } = event;

  const body = {
    summary: summary || "Appointment",
    description: description || undefined,
    location: location || undefined,
    start: { dateTime: startIso, timeZone },
    end: { dateTime: endIso, timeZone },
  };

  const validAttendees = attendeeEmails.filter(
    (e) => typeof e === "string" && e.includes("@"),
  );
  if (validAttendees.length > 0) {
    body.attendees = validAttendees.map((email) => ({ email }));
  }

  const data = await googleCalendarFetch(
    EVENTS_ENDPOINT,
    accessToken,
    { method: "POST", body: JSON.stringify(body) },
    "Google Calendar event create",
  );
  return data.id || null;
}

/** Deletes a previously-created primary-calendar event. Best-effort. */
async function deleteEvent(accessToken, eventId) {
  if (!eventId) return;
  const res = await fetch(`${EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404/410 mean it's already gone — treat as success.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const err = new Error(`Google Calendar event delete failed (HTTP ${res.status})`);
    err.googleError = true;
    throw err;
  }
}

module.exports = {
  CALENDAR_SCOPE,
  hasCalendarScope,
  listBusyTimes,
  createEvent,
  deleteEvent,
};
