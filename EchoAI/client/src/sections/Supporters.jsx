import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

// Voter CRM — supporters (voters / donors / volunteers) + campaign events for
// political-campaign brands. Only reachable when the selected brand is
// political (App.jsx canOpenSection gates the nav + render).

const TYPE_LABELS = { voter: "Voter", donor: "Donor", volunteer: "Volunteer" };
const STATUS_LABELS = {
  new: "New",
  contacted: "Contacted",
  engaged: "Engaged",
  committed: "Committed",
};
const TYPE_COLORS = {
  voter: "bg-sky-500/15 text-sky-300",
  donor: "bg-emerald-500/15 text-emerald-300",
  volunteer: "bg-violet-500/15 text-violet-300",
};

const EMPTY_SUPPORTER = {
  name: "",
  email: "",
  phone: "",
  supporterType: "voter",
  status: "new",
  donationAmount: "",
  notes: "",
};

const EMPTY_EVENT = {
  eventName: "",
  eventDate: "",
  location: "",
  attendance: "",
  notes: "",
};

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? String(d)
    : dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const inputCls =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-teal-500 focus:outline-none";

export default function Supporters({ brandId }) {
  const [tab, setTab] = useState("supporters");
  const [supporters, setSupporters] = useState([]);
  const [summary, setSummary] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const [form, setForm] = useState(null); // supporter add/edit form state
  const [eventForm, setEventForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!brandId) return;
    setError("");
    try {
      const [sup, ev] = await Promise.all([
        api.getSupporters(brandId, {
          type: typeFilter,
          status: statusFilter,
          search,
        }),
        api.getCampaignEvents(brandId),
      ]);
      setSupporters(sup.supporters || []);
      setSummary(sup.summary || null);
      setEvents(ev.events || []);
      setLoaded(true);
    } catch (err) {
      setError(err.message || "Couldn't load your supporter list.");
    } finally {
      setLoading(false);
    }
  }, [brandId, typeFilter, statusFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSupporter = async () => {
    if (!form || saving) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        supporterType: form.supporterType,
        status: form.status,
        donationAmount: form.donationAmount === "" ? null : form.donationAmount,
        notes: form.notes || null,
      };
      if (form.supporter_id) {
        await api.updateSupporter(brandId, form.supporter_id, body);
        setNotice("Supporter updated.");
      } else {
        await api.createSupporter(brandId, body);
        setNotice("Supporter added.");
      }
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't save this supporter.");
    } finally {
      setSaving(false);
    }
  };

  const removeSupporter = async (s) => {
    if (!window.confirm(`Remove ${s.name} from your supporter list?`)) return;
    setError("");
    try {
      await api.deleteSupporter(brandId, s.supporter_id);
      setNotice("Supporter removed.");
      await load();
    } catch (err) {
      setError(err.message || "Couldn't remove this supporter.");
    }
  };

  const saveEvent = async () => {
    if (!eventForm || saving) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        eventName: eventForm.eventName,
        eventDate: eventForm.eventDate,
        location: eventForm.location || null,
        attendance: eventForm.attendance === "" ? null : eventForm.attendance,
        notes: eventForm.notes || null,
      };
      if (eventForm.event_id) {
        await api.updateCampaignEvent(brandId, eventForm.event_id, body);
        setNotice("Event updated.");
      } else {
        await api.createCampaignEvent(brandId, body);
        setNotice("Event added.");
      }
      setEventForm(null);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't save this event.");
    } finally {
      setSaving(false);
    }
  };

  const removeEvent = async (ev) => {
    if (!window.confirm(`Remove the event "${ev.event_name}"?`)) return;
    setError("");
    try {
      await api.deleteCampaignEvent(brandId, ev.event_id);
      setNotice("Event removed.");
      await load();
    } catch (err) {
      setError(err.message || "Couldn't remove this event.");
    }
  };

  if (!brandId) {
    return <div className="p-6 text-sm text-gray-400">Select a campaign first.</div>;
  }

  if (loading && !loaded) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray-400">
        Loading your voter CRM…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-100">Voter CRM</h2>
        <p className="mt-1 text-sm text-gray-400">
          Keep track of every voter, donor and volunteer your campaign talks to — plus your
          rallies, town halls and fundraisers.
        </p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["Total contacts", summary.total],
            ["Voters", summary.voters],
            ["Donors", summary.donors],
            ["Volunteers", summary.volunteers],
            ["Donations", fmtMoney(summary.donations_total)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {label}
              </div>
              <div className="mt-1 text-xl font-bold text-gray-100">{value}</div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded-xl border border-teal-800 bg-teal-950/40 p-3 text-sm text-teal-300">
          {notice}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          ["supporters", "Supporters"],
          ["events", "Campaign Events"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === key
                ? "bg-teal-600 text-white"
                : "bg-gray-900 text-gray-400 hover:text-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "supporters" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or phone…"
              className={`${inputCls} max-w-xs`}
            />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All types</option>
              <option value="voter">Voters</option>
              <option value="donor">Donors</option>
              <option value="volunteer">Volunteers</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button
              onClick={() => setForm({ ...EMPTY_SUPPORTER })}
              className="ml-auto rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
            >
              + Add supporter
            </button>
          </div>

          {form && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="mb-3 text-sm font-bold text-gray-200">
                {form.supporter_id ? "Edit supporter" : "Add a supporter"}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input className={inputCls} placeholder="Full name *" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input className={inputCls} placeholder="Email" value={form.email || ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <input className={inputCls} placeholder="Phone" value={form.phone || ""}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <select className={inputCls} value={form.supporterType}
                  onChange={(e) => setForm({ ...form, supporterType: e.target.value })}>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <select className={inputCls} value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <input className={inputCls} placeholder="Total donations ($)" inputMode="decimal"
                  value={form.donationAmount ?? ""}
                  onChange={(e) => setForm({ ...form, donationAmount: e.target.value })} />
                <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Notes"
                  value={form.notes || ""}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveSupporter}
                  disabled={saving || !form.name.trim()}
                  className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setForm(null)}
                  className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-700">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {supporters.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">
              No supporters yet. Add your first voter, donor or volunteer above — your website
              chatbot and lead capture will also feed this list as people engage.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-900/80 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">Donations</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {supporters.map((s) => (
                    <tr key={s.supporter_id} className="bg-gray-950/40">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-100">{s.name}</div>
                        {s.notes && <div className="mt-0.5 max-w-xs truncate text-xs text-gray-500">{s.notes}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_COLORS[s.supporter_type] || "bg-gray-800 text-gray-300"}`}>
                          {TYPE_LABELS[s.supporter_type] || s.supporter_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{STATUS_LABELS[s.status] || s.status}</td>
                      <td className="px-4 py-3 text-gray-400">
                        <div>{s.email || "—"}</div>
                        <div className="text-xs">{s.phone || ""}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{fmtMoney(s.donation_amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() =>
                            setForm({
                              supporter_id: s.supporter_id,
                              name: s.name || "",
                              email: s.email || "",
                              phone: s.phone || "",
                              supporterType: s.supporter_type || "voter",
                              status: s.status || "new",
                              donationAmount: s.donation_amount ?? "",
                              notes: s.notes || "",
                            })
                          }
                          className="mr-2 text-xs font-semibold text-teal-400 hover:text-teal-300"
                        >
                          Edit
                        </button>
                        <button onClick={() => removeSupporter(s)}
                          className="text-xs font-semibold text-red-400 hover:text-red-300">
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "events" && (
        <div className="space-y-4">
          <div className="flex">
            <button
              onClick={() => setEventForm({ ...EMPTY_EVENT })}
              className="ml-auto rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
            >
              + Add event
            </button>
          </div>

          {eventForm && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="mb-3 text-sm font-bold text-gray-200">
                {eventForm.event_id ? "Edit event" : "Add a campaign event"}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input className={inputCls} placeholder="Event name *" value={eventForm.eventName}
                  onChange={(e) => setEventForm({ ...eventForm, eventName: e.target.value })} />
                <input className={inputCls} type="date" value={eventForm.eventDate}
                  onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })} />
                <input className={inputCls} placeholder="Location" value={eventForm.location || ""}
                  onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} />
                <input className={inputCls} placeholder="Attendance (people)" inputMode="numeric"
                  value={eventForm.attendance ?? ""}
                  onChange={(e) => setEventForm({ ...eventForm, attendance: e.target.value })} />
                <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Notes"
                  value={eventForm.notes || ""}
                  onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })} />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveEvent}
                  disabled={saving || !eventForm.eventName.trim() || !eventForm.eventDate}
                  className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setEventForm(null)}
                  className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-700">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {events.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">
              No events yet. Add your rallies, town halls, canvassing days and fundraisers to
              track turnout over time.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {events.map((ev) => (
                <div key={ev.event_id} className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-gray-100">{ev.event_name}</div>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {fmtDate(ev.event_date)}
                        {ev.location ? ` · ${ev.location}` : ""}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <button
                        onClick={() =>
                          setEventForm({
                            event_id: ev.event_id,
                            eventName: ev.event_name || "",
                            eventDate: ev.event_date ? String(ev.event_date).slice(0, 10) : "",
                            location: ev.location || "",
                            attendance: ev.attendance ?? "",
                            notes: ev.notes || "",
                          })
                        }
                        className="mr-2 font-semibold text-teal-400 hover:text-teal-300"
                      >
                        Edit
                      </button>
                      <button onClick={() => removeEvent(ev)} className="font-semibold text-red-400 hover:text-red-300">
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-gray-300">
                    {ev.attendance != null ? `${ev.attendance} attended` : "Attendance not recorded"}
                  </div>
                  {ev.notes && <div className="mt-1 text-xs text-gray-500">{ev.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
