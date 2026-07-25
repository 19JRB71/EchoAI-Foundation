import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import GoogleConnect from "../components/GoogleConnect.jsx";

const TABS = [
  { key: "calendar", label: "Calendar" },
  { key: "availability", label: "Availability" },
  { key: "history", label: "History" },
];

const STATUS_LABELS = {
  scheduled: { label: "Scheduled", cls: "bg-sky-500/15 text-sky-300" },
  completed: { label: "Completed", cls: "bg-emerald-500/15 text-emerald-300" },
  cancelled: { label: "Cancelled", cls: "bg-gray-600/30 text-gray-300" },
  no_show: { label: "No-show", cls: "bg-red-500/15 text-red-300" },
};

const SOURCE_LABELS = {
  chatbot: "Website chat",
  phone: "Phone call",
  manual: "Manual",
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function StatusBadge({ value }) {
  const meta = STATUS_LABELS[value];
  if (!meta) return <span className="text-gray-500">—</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function fmt(dt) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Appointments({ brandId }) {
  const [tab, setTab] = useState("calendar");
  const [appointments, setAppointments] = useState([]);
  const [timezone, setTimezone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getAppointments(brandId);
      setAppointments(data.appointments || []);
      setTimezone(data.timezone || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setAppointments([]);
    load();
  }, [load]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up = [];
    const pa = [];
    for (const a of appointments) {
      if (a.status === "scheduled" && new Date(a.start_time).getTime() >= now) {
        up.push(a);
      } else {
        pa.push(a);
      }
    }
    pa.sort((x, y) => new Date(y.start_time) - new Date(x.start_time));
    return { upcoming: up, past: pa };
  }, [appointments]);

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to manage appointments.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Appointments</h2>
        <p className="mt-1 text-sm text-gray-400">
          Your AI chat and phone agents book meetings with hot leads
          automatically. Set your availability, sync Google Calendar, and manage
          every booking here.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              "rounded-lg px-4 py-2 text-sm font-semibold transition",
              tab === t.key
                ? "bg-amber-500 text-gray-900"
                : "border border-gray-700 text-gray-300 hover:bg-gray-800",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : tab === "calendar" ? (
        <CalendarTab
          brandId={brandId}
          upcoming={upcoming}
          timezone={timezone}
          onChange={load}
        />
      ) : tab === "availability" ? (
        <AvailabilityTab brandId={brandId} />
      ) : (
        <HistoryTab past={past} />
      )}
    </div>
  );
}

function CalendarTab({ brandId, upcoming, timezone, onChange }) {
  return (
    <div className="space-y-6">
      <BookPanel brandId={brandId} onBooked={onChange} />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">
            Upcoming appointments
          </h3>
          {timezone && (
            <span className="text-xs text-gray-500">Times in {timezone}</span>
          )}
        </div>
        {upcoming.length === 0 ? (
          <p className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
            No upcoming appointments. When a hot lead agrees to a time on chat or
            a call, it will appear here.
          </p>
        ) : (
          <div className="space-y-3">
            {upcoming.map((a) => (
              <AppointmentCard key={a.appointment_id} appt={a} onChange={onChange} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AppointmentCard({ appt, onChange }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function act(patch, label) {
    setBusy(label);
    setError("");
    try {
      await api.updateAppointment(appt.appointment_id, patch);
      if (onChange) await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-100">
            {appt.title || "Appointment"}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">
            {fmt(appt.start_time)} – {fmt(appt.end_time)}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {appt.contact_name || appt.lead_name || "Lead"}
            {appt.contact_email ? ` · ${appt.contact_email}` : ""}
            {appt.contact_phone ? ` · ${appt.contact_phone}` : ""}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <StatusBadge value={appt.status} />
            {appt.google_event_id && (
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300">
                On Calendar
              </span>
            )}
          </div>
          <span className="text-xs text-gray-500">
            {SOURCE_LABELS[appt.source] || appt.source}
          </span>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {appt.status === "scheduled" && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-800 pt-3">
          <button
            onClick={() => act({ status: "completed" }, "completed")}
            disabled={!!busy}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy === "completed" ? "…" : "Mark complete"}
          </button>
          <button
            onClick={() => act({ status: "no_show" }, "no_show")}
            disabled={!!busy}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:bg-gray-800 disabled:opacity-50"
          >
            {busy === "no_show" ? "…" : "No-show"}
          </button>
          <button
            onClick={() => act({ status: "cancelled" }, "cancelled")}
            disabled={!!busy}
            className="rounded-lg border border-red-700/60 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
          >
            {busy === "cancelled" ? "…" : "Cancel"}
          </button>
        </div>
      )}
    </div>
  );
}

function BookPanel({ brandId, onBooked }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [booking, setBooking] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [open, setOpen] = useState(false);

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getOpenSlots(brandId);
      setSlots(data.slots || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    if (open) loadSlots();
  }, [open, loadSlots]);

  async function book(slot) {
    setBooking(slot.start);
    setError("");
    setNotice("");
    try {
      await api.bookAppointment({
        brandId,
        startTime: slot.start,
        endTime: slot.end,
        contactName: form.name || null,
        contactEmail: form.email || null,
        contactPhone: form.phone || null,
      });
      setNotice(`Booked ${slot.label}.`);
      setForm({ name: "", email: "", phone: "" });
      await loadSlots();
      if (onBooked) await onBooked();
    } catch (err) {
      setError(err.message);
    } finally {
      setBooking("");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-400"
      >
        + Book an appointment
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">Book manually</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-gray-400 hover:text-gray-200"
        >
          Close
        </button>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="mb-3 rounded-lg border border-emerald-700/50 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Contact name"
          className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
        />
        <input
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="Email (for confirmation)"
          className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
        />
        <input
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="Phone (for SMS)"
          className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
        />
      </div>

      {loading ? (
        <Spinner />
      ) : slots.length === 0 ? (
        <p className="text-sm text-gray-400">
          No open slots in the next two weeks. Set your weekly hours in the
          Availability tab.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {slots.map((s) => (
            <button
              key={s.start}
              onClick={() => book(s)}
              disabled={!!booking}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
            >
              {booking === s.start ? "Booking…" : s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AvailabilityTab({ brandId }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const cfg = await api.getAvailabilityConfig(brandId);
      setConfig(cfg);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  function dayEnabled(day) {
    return config.weeklyHours.some((w) => w.day === day);
  }

  function windowFor(day) {
    return (
      config.weeklyHours.find((w) => w.day === day) || {
        day,
        start: "09:00",
        end: "17:00",
      }
    );
  }

  function toggleDay(day) {
    const exists = dayEnabled(day);
    const next = exists
      ? config.weeklyHours.filter((w) => w.day !== day)
      : [...config.weeklyHours, { day, start: "09:00", end: "17:00" }];
    setConfig({ ...config, weeklyHours: next.sort((a, b) => a.day - b.day) });
  }

  function setWindow(day, field, value) {
    setConfig({
      ...config,
      weeklyHours: config.weeklyHours.map((w) =>
        w.day === day ? { ...w, [field]: value } : w,
      ),
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.saveAvailabilityConfig(brandId, {
        timezone: config.timezone,
        slotDurationMinutes: Number(config.slotDurationMinutes),
        bufferMinutes: Number(config.bufferMinutes),
        weeklyHours: config.weeklyHours,
      });
      setNotice("Availability saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !config) return <Spinner />;

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="rounded-lg border border-emerald-700/50 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-1 text-sm font-semibold text-gray-200">
          Google Calendar
        </h3>
        <p className="mb-3 text-xs text-gray-400">
          Connect Google Calendar so booked meetings are added automatically and
          your existing busy times are never double-booked.
        </p>
        {config.calendarConnected ? (
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-700/50 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Calendar connected
          </div>
        ) : (
          <GoogleConnect onChange={load} />
        )}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-200">
          Booking settings
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">Timezone</span>
            <input
              value={config.timezone}
              onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
              placeholder="America/New_York"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">
              Meeting length (min)
            </span>
            <input
              type="number"
              min="5"
              max="480"
              value={config.slotDurationMinutes}
              onChange={(e) =>
                setConfig({ ...config, slotDurationMinutes: e.target.value })
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">
              Buffer between (min)
            </span>
            <input
              type="number"
              min="0"
              max="240"
              value={config.bufferMinutes}
              onChange={(e) =>
                setConfig({ ...config, bufferMinutes: e.target.value })
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-200">Weekly hours</h3>
        <div className="space-y-2">
          {DAY_NAMES.map((name, day) => {
            const enabled = dayEnabled(day);
            const w = windowFor(day);
            return (
              <div key={day} className="flex items-center gap-3">
                <label className="flex w-32 items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleDay(day)}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-950"
                  />
                  {name}
                </label>
                {enabled ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={w.start}
                      onChange={(e) => setWindow(day, "start", e.target.value)}
                      className="rounded-lg border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-gray-100"
                    />
                    <span className="text-gray-500">to</span>
                    <input
                      type="time"
                      value={w.end}
                      onChange={(e) => setWindow(day, "end", e.target.value)}
                      className="rounded-lg border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-gray-100"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-gray-600">Unavailable</span>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="mt-5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-400 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save availability"}
        </button>
      </div>

      <BlocksPanel
        brandId={brandId}
        blocks={config.blocks || []}
        onChange={load}
      />
    </div>
  );
}

function BlocksPanel({ brandId, blocks, onChange }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    if (!start || !end) {
      setError("Pick a start and end time.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.addAvailabilityBlock({
        brandId,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        reason: reason || null,
      });
      setStart("");
      setEnd("");
      setReason("");
      if (onChange) await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(blockId) {
    setError("");
    try {
      await api.deleteAvailabilityBlock(blockId);
      if (onChange) await onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="mb-1 text-sm font-semibold text-gray-200">
        Blackout dates
      </h3>
      <p className="mb-4 text-xs text-gray-400">
        Block off holidays or time away so nothing can be booked then.
      </p>

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">From</span>
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">To</span>
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Reason</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100 placeholder-gray-500"
          />
        </label>
        <div className="flex items-end">
          <button
            onClick={add}
            disabled={busy}
            className="w-full rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-200 transition hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add block"}
          </button>
        </div>
      </div>

      {blocks.length > 0 && (
        <div className="mt-4 space-y-2">
          {blocks.map((b) => (
            <div
              key={b.block_id}
              className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm"
            >
              <span className="text-gray-300">
                {fmt(b.start_time)} – {fmt(b.end_time)}
                {b.reason ? ` · ${b.reason}` : ""}
              </span>
              <button
                onClick={() => remove(b.block_id)}
                className="text-xs font-semibold text-red-400 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryTab({ past }) {
  if (past.length === 0) {
    return (
      <p className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
        No past appointments yet.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {past.map((a) => (
        <div
          key={a.appointment_id}
          className="rounded-xl border border-gray-800 bg-gray-900 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-100">
                {a.title || "Appointment"}
              </div>
              <div className="mt-0.5 text-xs text-gray-400">
                {fmt(a.start_time)}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {a.contact_name || a.lead_name || "Lead"}
                {a.contact_email ? ` · ${a.contact_email}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                {SOURCE_LABELS[a.source] || a.source}
              </span>
              <StatusBadge value={a.status} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
