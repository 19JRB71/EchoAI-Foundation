import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

// Property CRM — listings, buyer/seller leads and open houses for real-estate
// brands. Only reachable when the selected brand is real_estate (App.jsx
// canOpenSection gates the nav + render).

const LISTING_STATUS_LABELS = {
  active: "Active",
  pending: "Pending",
  sold: "Sold",
  withdrawn: "Withdrawn",
};
const LISTING_STATUS_COLORS = {
  active: "bg-emerald-500/15 text-emerald-300",
  pending: "bg-amber-500/15 text-amber-300",
  sold: "bg-sky-500/15 text-sky-300",
  withdrawn: "bg-gray-700/40 text-gray-400",
};
const LEAD_STATUS_LABELS = {
  new: "New",
  contacted: "Contacted",
  engaged: "Engaged",
  converted: "Converted",
};
const BUYER_CATEGORIES = {
  actively_looking: "Actively looking",
  casually_browsing: "Casually browsing",
  not_ready: "Not ready yet",
};
const SELLER_CATEGORIES = {
  ready_to_list: "Ready to list",
  thinking_about_it: "Thinking about it",
  just_curious: "Just curious",
};

const EMPTY_LISTING = {
  address: "",
  city: "",
  state: "",
  zip: "",
  price: "",
  beds: "",
  baths: "",
  sqft: "",
  keyFeatures: "",
  description: "",
  status: "active",
  soldDate: "",
  gciAmount: "",
};

const EMPTY_LEAD = {
  leadKind: "buyer",
  name: "",
  email: "",
  phone: "",
  budget: "",
  timeline: "",
  mustHaves: "",
  motivation: "",
  currentHome: "",
  category: "",
  status: "new",
  notes: "",
};

const EMPTY_OPEN_HOUSE = {
  listingId: "",
  address: "",
  eventDate: "",
  startTime: "",
  endTime: "",
  notes: "",
};

const EMPTY_ATTENDEE = { name: "", email: "", phone: "", interested: false, notes: "" };

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? String(d)
    : dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function numOrNull(v) {
  return v === "" || v == null ? null : v;
}

const inputCls =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-teal-500 focus:outline-none";

export default function Properties({ brandId }) {
  const [tab, setTab] = useState("listings");
  const [listings, setListings] = useState([]);
  const [summary, setSummary] = useState(null);
  const [leads, setLeads] = useState([]);
  const [leadSummary, setLeadSummary] = useState(null);
  const [openHouses, setOpenHouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [listingStatusFilter, setListingStatusFilter] = useState("");
  const [leadKindFilter, setLeadKindFilter] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("");
  const [leadSearch, setLeadSearch] = useState("");

  const [listingForm, setListingForm] = useState(null);
  const [leadForm, setLeadForm] = useState(null);
  const [ohForm, setOhForm] = useState(null);
  const [saving, setSaving] = useState(false);

  // Attendee panel: which open house is expanded + its attendee list.
  const [attendeesFor, setAttendeesFor] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [attendeeForm, setAttendeeForm] = useState(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setError("");
    try {
      const [lst, lds, ohs] = await Promise.all([
        api.getListings(brandId, { status: listingStatusFilter }),
        api.getPropertyLeads(brandId, {
          kind: leadKindFilter,
          status: leadStatusFilter,
          search: leadSearch,
        }),
        api.getOpenHouses(brandId),
      ]);
      setListings(lst.listings || []);
      setSummary(lst.summary || null);
      setLeads(lds.leads || []);
      setLeadSummary(lds.summary || null);
      setOpenHouses(ohs.openHouses || []);
      setLoaded(true);
    } catch (err) {
      setError(err.message || "Couldn't load your property CRM.");
    } finally {
      setLoading(false);
    }
  }, [brandId, listingStatusFilter, leadKindFilter, leadStatusFilter, leadSearch]);

  useEffect(() => {
    load();
  }, [load]);

  const loadAttendees = async (oh) => {
    setError("");
    try {
      const res = await api.getOpenHouseAttendees(brandId, oh.open_house_id);
      setAttendees(res.attendees || []);
      setAttendeesFor(oh.open_house_id);
      setAttendeeForm(null);
    } catch (err) {
      setError(err.message || "Couldn't load the attendee list.");
    }
  };

  const saveListing = async () => {
    if (!listingForm || saving) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        address: listingForm.address,
        city: listingForm.city || null,
        state: listingForm.state || null,
        zip: listingForm.zip || null,
        price: numOrNull(listingForm.price),
        beds: numOrNull(listingForm.beds),
        baths: numOrNull(listingForm.baths),
        sqft: numOrNull(listingForm.sqft),
        keyFeatures: listingForm.keyFeatures || null,
        description: listingForm.description || null,
        status: listingForm.status,
        soldDate: listingForm.status === "sold" ? listingForm.soldDate || null : null,
        gciAmount: listingForm.status === "sold" ? numOrNull(listingForm.gciAmount) : null,
      };
      if (listingForm.listing_id) {
        await api.updateListing(brandId, listingForm.listing_id, body);
        setNotice("Listing updated.");
      } else {
        await api.createListing(brandId, body);
        setNotice(
          "Listing added. Atlas will automatically draft promotion ads for it within the next hour."
        );
      }
      setListingForm(null);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't save this listing.");
    } finally {
      setSaving(false);
    }
  };

  const removeListing = async (l) => {
    if (!window.confirm(`Remove the listing at ${l.address}?`)) return;
    setError("");
    try {
      await api.deleteListing(brandId, l.listing_id);
      setNotice("Listing removed.");
      await load();
    } catch (err) {
      setError(err.message || "Couldn't remove this listing.");
    }
  };

  const saveLead = async () => {
    if (!leadForm || saving) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        leadKind: leadForm.leadKind,
        name: leadForm.name,
        email: leadForm.email || null,
        phone: leadForm.phone || null,
        budget: leadForm.budget || null,
        timeline: leadForm.timeline || null,
        mustHaves: leadForm.mustHaves || null,
        motivation: leadForm.motivation || null,
        currentHome: leadForm.currentHome || null,
        category: leadForm.category || null,
        status: leadForm.status,
        notes: leadForm.notes || null,
      };
      if (leadForm.property_lead_id) {
        await api.updatePropertyLead(brandId, leadForm.property_lead_id, body);
        setNotice("Lead updated.");
      } else {
        await api.createPropertyLead(brandId, body);
        setNotice("Lead added.");
      }
      setLeadForm(null);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't save this lead.");
    } finally {
      setSaving(false);
    }
  };

  const removeLead = async (l) => {
    if (!window.confirm(`Remove ${l.name} from your property leads?`)) return;
    setError("");
    try {
      await api.deletePropertyLead(brandId, l.property_lead_id);
      setNotice("Lead removed.");
      await load();
    } catch (err) {
      setError(err.message || "Couldn't remove this lead.");
    }
  };

  const saveOpenHouse = async () => {
    if (!ohForm || saving) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        listingId: ohForm.listingId || null,
        address: ohForm.address || null,
        eventDate: ohForm.eventDate,
        startTime: ohForm.startTime || null,
        endTime: ohForm.endTime || null,
        notes: ohForm.notes || null,
      };
      if (ohForm.open_house_id) {
        await api.updateOpenHouse(brandId, ohForm.open_house_id, body);
        setNotice("Open house updated.");
      } else {
        await api.createOpenHouse(brandId, body);
        setNotice(
          "Open house scheduled. Nova will promote it the week before, remind interested buyers the day before, and follow up with attendees afterward."
        );
      }
      setOhForm(null);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't save this open house.");
    } finally {
      setSaving(false);
    }
  };

  const removeOpenHouse = async (oh) => {
    if (!window.confirm(`Remove the open house at ${oh.address}?`)) return;
    setError("");
    try {
      await api.deleteOpenHouse(brandId, oh.open_house_id);
      setNotice("Open house removed.");
      if (attendeesFor === oh.open_house_id) setAttendeesFor(null);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't remove this open house.");
    }
  };

  const saveAttendee = async (openHouseId) => {
    if (!attendeeForm || saving) return;
    setSaving(true);
    setError("");
    try {
      await api.createOpenHouseAttendee(brandId, openHouseId, {
        name: attendeeForm.name,
        email: attendeeForm.email || null,
        phone: attendeeForm.phone || null,
        interested: attendeeForm.interested === true,
        notes: attendeeForm.notes || null,
      });
      setNotice("Attendee added.");
      setAttendeeForm(null);
      const res = await api.getOpenHouseAttendees(brandId, openHouseId);
      setAttendees(res.attendees || []);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't add this attendee.");
    } finally {
      setSaving(false);
    }
  };

  const removeAttendee = async (openHouseId, a) => {
    if (!window.confirm(`Remove ${a.name} from the attendee list?`)) return;
    setError("");
    try {
      await api.deleteOpenHouseAttendee(brandId, openHouseId, a.attendee_id);
      const res = await api.getOpenHouseAttendees(brandId, openHouseId);
      setAttendees(res.attendees || []);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't remove this attendee.");
    }
  };

  if (!brandId) {
    return <div className="p-6 text-sm text-gray-400">Select a business first.</div>;
  }

  if (loading && !loaded) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray-400">
        Loading your property CRM…
      </div>
    );
  }

  const categoryLabels = leadForm?.leadKind === "seller" ? SELLER_CATEGORIES : BUYER_CATEGORIES;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-100">Property CRM</h2>
        <p className="mt-1 text-sm text-gray-400">
          Your listings, buyer and seller leads, and open houses — with Atlas promoting new
          listings and Nova handling open-house promotion, reminders and follow-ups automatically.
        </p>
      </div>

      {/* Summary cards */}
      {(summary || leadSummary) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["Active listings", summary ? summary.active : "—"],
            ["Sold", summary ? summary.sold : "—"],
            ["Commission earned", summary ? fmtMoney(summary.gci_total) : "—"],
            ["Buyer leads", leadSummary ? leadSummary.buyers : "—"],
            ["Seller leads", leadSummary ? leadSummary.sellers : "—"],
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
          ["listings", "Listings"],
          ["leads", "Buyers & Sellers"],
          ["openhouses", "Open Houses"],
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

      {/* ------------------------------ Listings ------------------------------ */}
      {tab === "listings" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={listingStatusFilter}
              onChange={(e) => setListingStatusFilter(e.target.value)}
              className={`${inputCls} w-auto`}
            >
              <option value="">All statuses</option>
              {Object.entries(LISTING_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button
              onClick={() => setListingForm({ ...EMPTY_LISTING })}
              className="ml-auto rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
            >
              + Add listing
            </button>
          </div>

          {listingForm && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="mb-3 text-sm font-bold text-gray-200">
                {listingForm.listing_id ? "Edit listing" : "Add a listing"}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input className={`${inputCls} sm:col-span-2`} placeholder="Street address *"
                  value={listingForm.address}
                  onChange={(e) => setListingForm({ ...listingForm, address: e.target.value })} />
                <input className={inputCls} placeholder="City" value={listingForm.city || ""}
                  onChange={(e) => setListingForm({ ...listingForm, city: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <input className={inputCls} placeholder="State" value={listingForm.state || ""}
                    onChange={(e) => setListingForm({ ...listingForm, state: e.target.value })} />
                  <input className={inputCls} placeholder="ZIP" value={listingForm.zip || ""}
                    onChange={(e) => setListingForm({ ...listingForm, zip: e.target.value })} />
                </div>
                <input className={inputCls} placeholder="Price ($)" inputMode="decimal"
                  value={listingForm.price ?? ""}
                  onChange={(e) => setListingForm({ ...listingForm, price: e.target.value })} />
                <div className="grid grid-cols-3 gap-3">
                  <input className={inputCls} placeholder="Beds" inputMode="numeric"
                    value={listingForm.beds ?? ""}
                    onChange={(e) => setListingForm({ ...listingForm, beds: e.target.value })} />
                  <input className={inputCls} placeholder="Baths" inputMode="decimal"
                    value={listingForm.baths ?? ""}
                    onChange={(e) => setListingForm({ ...listingForm, baths: e.target.value })} />
                  <input className={inputCls} placeholder="Sqft" inputMode="numeric"
                    value={listingForm.sqft ?? ""}
                    onChange={(e) => setListingForm({ ...listingForm, sqft: e.target.value })} />
                </div>
                <input className={`${inputCls} sm:col-span-2`}
                  placeholder="Key features (e.g. renovated kitchen, big backyard, near schools)"
                  value={listingForm.keyFeatures || ""}
                  onChange={(e) => setListingForm({ ...listingForm, keyFeatures: e.target.value })} />
                <select className={inputCls} value={listingForm.status}
                  onChange={(e) => setListingForm({ ...listingForm, status: e.target.value })}>
                  {Object.entries(LISTING_STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                {listingForm.status === "sold" && (
                  <div className="grid grid-cols-2 gap-3">
                    <input className={inputCls} type="date" title="Sold date"
                      value={listingForm.soldDate || ""}
                      onChange={(e) => setListingForm({ ...listingForm, soldDate: e.target.value })} />
                    <input className={inputCls} placeholder="Commission earned ($)" inputMode="decimal"
                      value={listingForm.gciAmount ?? ""}
                      onChange={(e) => setListingForm({ ...listingForm, gciAmount: e.target.value })} />
                  </div>
                )}
                <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Description"
                  value={listingForm.description || ""}
                  onChange={(e) => setListingForm({ ...listingForm, description: e.target.value })} />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveListing}
                  disabled={saving || !listingForm.address.trim() || (listingForm.status === "sold" && !listingForm.soldDate)}
                  className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setListingForm(null)}
                  className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-700">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {listings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">
              No listings yet. Add your first listing above — Atlas will automatically create
              promotion ads for every new active listing.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-900/80 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Address</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Beds / Baths</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Listed</th>
                    <th className="px-4 py-3">Ads</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {listings.map((l) => (
                    <tr key={l.listing_id} className="bg-gray-950/40">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-100">{l.address}</div>
                        <div className="text-xs text-gray-500">
                          {[l.city, l.state, l.zip].filter(Boolean).join(", ")}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{fmtMoney(l.price)}</td>
                      <td className="px-4 py-3 text-gray-400">
                        {l.beds ?? "—"} / {l.baths ?? "—"}
                        {l.sqft ? ` · ${Number(l.sqft).toLocaleString()} sqft` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LISTING_STATUS_COLORS[l.status] || "bg-gray-800 text-gray-300"}`}>
                          {LISTING_STATUS_LABELS[l.status] || l.status}
                        </span>
                        {l.status === "sold" && l.gci_amount != null && (
                          <div className="mt-0.5 text-xs text-gray-500">{fmtMoney(l.gci_amount)} commission</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400">{fmtDate(l.listed_date)}</td>
                      <td className="px-4 py-3 text-xs">
                        {l.ad_promoted_at ? (
                          <span className="text-emerald-400">Ads drafted</span>
                        ) : l.status === "active" ? (
                          <span className="text-gray-500">Queued</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() =>
                            setListingForm({
                              listing_id: l.listing_id,
                              address: l.address || "",
                              city: l.city || "",
                              state: l.state || "",
                              zip: l.zip || "",
                              price: l.price ?? "",
                              beds: l.beds ?? "",
                              baths: l.baths ?? "",
                              sqft: l.sqft ?? "",
                              keyFeatures: l.key_features || "",
                              description: l.description || "",
                              status: l.status || "active",
                              soldDate: l.sold_date ? String(l.sold_date).slice(0, 10) : "",
                              gciAmount: l.gci_amount ?? "",
                            })
                          }
                          className="mr-2 text-xs font-semibold text-teal-400 hover:text-teal-300"
                        >
                          Edit
                        </button>
                        <button onClick={() => removeListing(l)}
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

      {/* ------------------------------ Leads ------------------------------ */}
      {tab === "leads" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={leadSearch}
              onChange={(e) => setLeadSearch(e.target.value)}
              placeholder="Search name, email or phone…"
              className={`${inputCls} max-w-xs`}
            />
            <select value={leadKindFilter} onChange={(e) => setLeadKindFilter(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">Buyers & sellers</option>
              <option value="buyer">Buyers</option>
              <option value="seller">Sellers</option>
            </select>
            <select value={leadStatusFilter} onChange={(e) => setLeadStatusFilter(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All statuses</option>
              {Object.entries(LEAD_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button
              onClick={() => setLeadForm({ ...EMPTY_LEAD })}
              className="ml-auto rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
            >
              + Add lead
            </button>
          </div>

          {leadForm && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="mb-3 text-sm font-bold text-gray-200">
                {leadForm.property_lead_id ? "Edit lead" : "Add a buyer or seller lead"}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <select className={inputCls} value={leadForm.leadKind}
                  onChange={(e) => setLeadForm({ ...leadForm, leadKind: e.target.value, category: "" })}>
                  <option value="buyer">Buyer</option>
                  <option value="seller">Seller</option>
                </select>
                <input className={inputCls} placeholder="Full name *" value={leadForm.name}
                  onChange={(e) => setLeadForm({ ...leadForm, name: e.target.value })} />
                <input className={inputCls} placeholder="Email" value={leadForm.email || ""}
                  onChange={(e) => setLeadForm({ ...leadForm, email: e.target.value })} />
                <input className={inputCls} placeholder="Phone" value={leadForm.phone || ""}
                  onChange={(e) => setLeadForm({ ...leadForm, phone: e.target.value })} />
                {leadForm.leadKind === "buyer" ? (
                  <>
                    <input className={inputCls} placeholder="Budget (e.g. $400k–$500k)"
                      value={leadForm.budget || ""}
                      onChange={(e) => setLeadForm({ ...leadForm, budget: e.target.value })} />
                    <input className={inputCls} placeholder="Timeline (e.g. next 3 months)"
                      value={leadForm.timeline || ""}
                      onChange={(e) => setLeadForm({ ...leadForm, timeline: e.target.value })} />
                    <input className={`${inputCls} sm:col-span-2`}
                      placeholder="Must-haves (e.g. 3 beds, garage, good schools)"
                      value={leadForm.mustHaves || ""}
                      onChange={(e) => setLeadForm({ ...leadForm, mustHaves: e.target.value })} />
                  </>
                ) : (
                  <>
                    <input className={inputCls} placeholder="Why they're selling"
                      value={leadForm.motivation || ""}
                      onChange={(e) => setLeadForm({ ...leadForm, motivation: e.target.value })} />
                    <input className={inputCls} placeholder="Their current home"
                      value={leadForm.currentHome || ""}
                      onChange={(e) => setLeadForm({ ...leadForm, currentHome: e.target.value })} />
                  </>
                )}
                <select className={inputCls} value={leadForm.category || ""}
                  onChange={(e) => setLeadForm({ ...leadForm, category: e.target.value })}>
                  <option value="">How ready are they?</option>
                  {Object.entries(categoryLabels).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <select className={inputCls} value={leadForm.status}
                  onChange={(e) => setLeadForm({ ...leadForm, status: e.target.value })}>
                  {Object.entries(LEAD_STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Notes"
                  value={leadForm.notes || ""}
                  onChange={(e) => setLeadForm({ ...leadForm, notes: e.target.value })} />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveLead}
                  disabled={saving || !leadForm.name.trim()}
                  className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setLeadForm(null)}
                  className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-700">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {leads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">
              No buyer or seller leads yet. Add one above — your website chatbot and ads will
              also feed this list as people reach out.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-900/80 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Readiness</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {leads.map((l) => (
                    <tr key={l.property_lead_id} className="bg-gray-950/40">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-100">{l.name}</div>
                        <div className="mt-0.5 max-w-xs truncate text-xs text-gray-500">
                          {l.lead_kind === "buyer"
                            ? [l.budget, l.timeline].filter(Boolean).join(" · ")
                            : l.motivation || ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${l.lead_kind === "buyer" ? "bg-sky-500/15 text-sky-300" : "bg-violet-500/15 text-violet-300"}`}>
                          {l.lead_kind === "buyer" ? "Buyer" : "Seller"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        {(l.lead_kind === "buyer" ? BUYER_CATEGORIES : SELLER_CATEGORIES)[l.category] || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-300">{LEAD_STATUS_LABELS[l.status] || l.status}</td>
                      <td className="px-4 py-3 text-gray-400">
                        <div>{l.email || "—"}</div>
                        <div className="text-xs">{l.phone || ""}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() =>
                            setLeadForm({
                              property_lead_id: l.property_lead_id,
                              leadKind: l.lead_kind || "buyer",
                              name: l.name || "",
                              email: l.email || "",
                              phone: l.phone || "",
                              budget: l.budget || "",
                              timeline: l.timeline || "",
                              mustHaves: l.must_haves || "",
                              motivation: l.motivation || "",
                              currentHome: l.current_home || "",
                              category: l.category || "",
                              status: l.status || "new",
                              notes: l.notes || "",
                            })
                          }
                          className="mr-2 text-xs font-semibold text-teal-400 hover:text-teal-300"
                        >
                          Edit
                        </button>
                        <button onClick={() => removeLead(l)}
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

      {/* ---------------------------- Open Houses ---------------------------- */}
      {tab === "openhouses" && (
        <div className="space-y-4">
          <div className="flex">
            <button
              onClick={() => setOhForm({ ...EMPTY_OPEN_HOUSE })}
              className="ml-auto rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
            >
              + Schedule open house
            </button>
          </div>

          {ohForm && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="mb-3 text-sm font-bold text-gray-200">
                {ohForm.open_house_id ? "Edit open house" : "Schedule an open house"}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <select className={inputCls} value={ohForm.listingId || ""}
                  onChange={(e) => {
                    const listingId = e.target.value;
                    const listing = listings.find((l) => l.listing_id === listingId);
                    setOhForm({
                      ...ohForm,
                      listingId,
                      address: listing ? listing.address : ohForm.address,
                    });
                  }}>
                  <option value="">Pick a listing (or type the address)</option>
                  {listings.map((l) => (
                    <option key={l.listing_id} value={l.listing_id}>{l.address}</option>
                  ))}
                </select>
                <input className={inputCls} placeholder="Address *" value={ohForm.address || ""}
                  onChange={(e) => setOhForm({ ...ohForm, address: e.target.value })} />
                <input className={inputCls} type="date" value={ohForm.eventDate || ""}
                  onChange={(e) => setOhForm({ ...ohForm, eventDate: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <input className={inputCls} placeholder="Start (e.g. 1:00 PM)"
                    value={ohForm.startTime || ""}
                    onChange={(e) => setOhForm({ ...ohForm, startTime: e.target.value })} />
                  <input className={inputCls} placeholder="End (e.g. 4:00 PM)"
                    value={ohForm.endTime || ""}
                    onChange={(e) => setOhForm({ ...ohForm, endTime: e.target.value })} />
                </div>
                <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Notes"
                  value={ohForm.notes || ""}
                  onChange={(e) => setOhForm({ ...ohForm, notes: e.target.value })} />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveOpenHouse}
                  disabled={saving || !(ohForm.address || "").trim() || !ohForm.eventDate}
                  className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setOhForm(null)}
                  className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-700">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {openHouses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">
              No open houses scheduled. Schedule one above and the AI team handles the rest —
              promotion the week before, buyer reminders the day before, and attendee follow-ups
              afterward.
            </div>
          ) : (
            <div className="grid gap-3">
              {openHouses.map((oh) => (
                <div key={oh.open_house_id} className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-gray-100">{oh.address}</div>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {fmtDate(oh.event_date)}
                        {oh.start_time ? ` · ${oh.start_time}` : ""}
                        {oh.end_time ? ` – ${oh.end_time}` : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${oh.promoted_at ? "bg-emerald-500/15 text-emerald-300" : "bg-gray-800 text-gray-500"}`}>
                          {oh.promoted_at ? "Promoted" : "Promotion pending"}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${oh.reminded_at ? "bg-emerald-500/15 text-emerald-300" : "bg-gray-800 text-gray-500"}`}>
                          {oh.reminded_at ? "Buyers reminded" : "Reminder pending"}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${oh.followed_up_at ? "bg-emerald-500/15 text-emerald-300" : "bg-gray-800 text-gray-500"}`}>
                          {oh.followed_up_at ? "Followed up" : "Follow-up pending"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <button
                        onClick={() =>
                          attendeesFor === oh.open_house_id
                            ? setAttendeesFor(null)
                            : loadAttendees(oh)
                        }
                        className="mr-2 font-semibold text-sky-400 hover:text-sky-300"
                      >
                        {attendeesFor === oh.open_house_id
                          ? "Hide attendees"
                          : `Attendees (${oh.attendee_count ?? 0})`}
                      </button>
                      <button
                        onClick={() =>
                          setOhForm({
                            open_house_id: oh.open_house_id,
                            listingId: oh.listing_id || "",
                            address: oh.address || "",
                            eventDate: oh.event_date ? String(oh.event_date).slice(0, 10) : "",
                            startTime: oh.start_time || "",
                            endTime: oh.end_time || "",
                            notes: oh.notes || "",
                          })
                        }
                        className="mr-2 font-semibold text-teal-400 hover:text-teal-300"
                      >
                        Edit
                      </button>
                      <button onClick={() => removeOpenHouse(oh)} className="font-semibold text-red-400 hover:text-red-300">
                        Remove
                      </button>
                    </div>
                  </div>

                  {attendeesFor === oh.open_house_id && (
                    <div className="mt-4 space-y-3 border-t border-gray-800 pt-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-200">
                          Sign-in sheet
                          {oh.interested_count > 0 && (
                            <span className="ml-2 text-xs font-normal text-emerald-400">
                              {oh.interested_count} interested
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => setAttendeeForm({ ...EMPTY_ATTENDEE })}
                          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-700"
                        >
                          + Add attendee
                        </button>
                      </div>

                      {attendeeForm && (
                        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <input className={inputCls} placeholder="Name *" value={attendeeForm.name}
                              onChange={(e) => setAttendeeForm({ ...attendeeForm, name: e.target.value })} />
                            <input className={inputCls} placeholder="Email" value={attendeeForm.email || ""}
                              onChange={(e) => setAttendeeForm({ ...attendeeForm, email: e.target.value })} />
                            <input className={inputCls} placeholder="Phone" value={attendeeForm.phone || ""}
                              onChange={(e) => setAttendeeForm({ ...attendeeForm, phone: e.target.value })} />
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                              <input type="checkbox" checked={attendeeForm.interested === true}
                                onChange={(e) => setAttendeeForm({ ...attendeeForm, interested: e.target.checked })} />
                              Interested in the home
                            </label>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => saveAttendee(oh.open_house_id)}
                              disabled={saving || !attendeeForm.name.trim()}
                              className="rounded-lg bg-teal-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                            <button onClick={() => setAttendeeForm(null)}
                              className="rounded-lg bg-gray-800 px-4 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-700">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {attendees.length === 0 ? (
                        <div className="text-xs text-gray-500">
                          No attendees recorded yet. Add everyone who signs in — they'll get an
                          automatic thank-you and follow-up email the day after.
                        </div>
                      ) : (
                        <ul className="divide-y divide-gray-800 text-sm">
                          {attendees.map((a) => (
                            <li key={a.attendee_id} className="flex items-center justify-between py-2">
                              <div>
                                <span className="font-medium text-gray-100">{a.name}</span>
                                {a.interested && (
                                  <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                                    Interested
                                  </span>
                                )}
                                <div className="text-xs text-gray-500">
                                  {[a.email, a.phone].filter(Boolean).join(" · ")}
                                </div>
                              </div>
                              <button onClick={() => removeAttendee(oh.open_house_id, a)}
                                className="text-xs font-semibold text-red-400 hover:text-red-300">
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
