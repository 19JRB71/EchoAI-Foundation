import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import { roleLabel, roleBadgeClass } from "../../lib/roles.js";

const inputClass =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const primaryBtn =
  "rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";

// Assignable workspace roles. "owner" is never assignable, and legacy "viewer"
// rows still render (via lib/roles.js) but new invites use these three.
const ROLES = [
  { value: "sales_rep", label: "Sales Rep — works one assigned lead at a time" },
  { value: "manager", label: "Manager — read-only access to everything" },
  { value: "admin", label: "Admin — manage team, billing & all tools" },
];

function StatusBadge({ status }) {
  const map = {
    active: "bg-green-500/15 text-green-400",
    pending: "bg-amber-500/15 text-amber-300",
    removed: "bg-gray-500/15 text-gray-400",
    deactivated: "bg-red-500/15 text-red-300",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
        map[status] || "bg-gray-500/15 text-gray-400"
      }`}
    >
      {status}
    </span>
  );
}

function RoleBadge({ role }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${roleBadgeClass(
        role,
      )}`}
    >
      {roleLabel(role)}
    </span>
  );
}

function fmtLastActive(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function TeamManagement({ isAdmin = false }) {
  const [members, setMembers] = useState([]);
  const [seats, setSeats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Invite form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("sales_rep");
  const [phone, setPhone] = useState("");
  const [inviting, setInviting] = useState(false);

  // Per-row action state
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getTeam();
      setMembers(data.members || []);
      setSeats(data.seats || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function invite(e) {
    e.preventDefault();
    const trimmed = email.trim();
    const trimmedPhone = phone.trim();
    if (role === "sales_rep" && !trimmedPhone) {
      setError(
        "A sales rep needs a phone number — the platform calls their phone first, then bridges the lead.",
      );
      return;
    }
    // Seat-charge confirmation: when this addition exceeds the plan's included
    // seats, surface the $50/seat charge and require explicit confirmation.
    // Every tier includes 1 seat, so this applies on all plans; the platform
    // admin is exempt, and includedSeats == null stays a defensive skip.
    const exceedsSeats =
      !isAdmin &&
      seats &&
      seats.includedSeats != null &&
      seats.teamSize + 1 > seats.includedSeats;
    if (exceedsSeats) {
      const seatPrice = seats.additionalSeatPrice;
      const included = seats.includedSeats;
      const ok = window.confirm(
        `Your plan includes ${included} seat${included === 1 ? "" : "s"}. ` +
          `Adding ${trimmed} is an additional seat billed at $${seatPrice}/seat/month, ` +
          `prorated on your next invoice. Add this seat and confirm the charge?`,
      );
      if (!ok) return;
    }
    setInviting(true);
    setError("");
    setNotice("");
    try {
      const res = await api.inviteTeamMember(
        trimmed,
        role,
        trimmedPhone || undefined,
      );
      setNotice(
        res.status === "active"
          ? `${trimmed} was added to your team.`
          : `Invitation sent to ${trimmed}.`,
      );
      setEmail("");
      setRole("sales_rep");
      setPhone("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  }

  async function resend(member) {
    setBusyId(member.teamMemberId);
    setError("");
    setNotice("");
    try {
      await api.resendTeamInvite(member.teamMemberId);
      setNotice(`Invitation re-sent to ${member.email}.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  async function changeRole(member, nextRole) {
    // Switching someone to Sales Rep requires a phone number. If we don't have
    // one on file, prompt for it inline so the backend guard doesn't 400.
    let nextPhone;
    if (nextRole === "sales_rep" && !member.phone) {
      const entered = window.prompt(
        `A sales rep needs a phone number (E.164, e.g. +15551234567) so the platform can bridge their calls. Enter ${member.email}'s phone:`,
      );
      if (!entered || !entered.trim()) return;
      nextPhone = entered.trim();
    }
    setBusyId(member.teamMemberId);
    setError("");
    setNotice("");
    try {
      await api.changeTeamRole(member.teamMemberId, nextRole, nextPhone);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  async function editPhone(member) {
    const entered = window.prompt(
      `Update ${member.email}'s phone (E.164, e.g. +15551234567):`,
      member.phone || "",
    );
    if (entered == null) return;
    setBusyId(member.teamMemberId);
    setError("");
    setNotice("");
    try {
      await api.changeTeamRole(member.teamMemberId, member.role, entered.trim());
      setNotice(`${member.email}'s phone was updated.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  async function deactivate(member) {
    if (
      !window.confirm(
        `Deactivate ${member.email}? They lose access immediately, but their call history and accountability logs are kept. You can reactivate them later.`,
      )
    )
      return;
    setBusyId(member.teamMemberId);
    setError("");
    setNotice("");
    try {
      await api.deactivateTeamMember(member.teamMemberId);
      setNotice(`${member.email} was deactivated.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  async function reactivate(member) {
    setBusyId(member.teamMemberId);
    setError("");
    setNotice("");
    try {
      await api.reactivateTeamMember(member.teamMemberId);
      setNotice(`${member.email} was reactivated.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  async function remove(member) {
    if (
      !window.confirm(
        `Remove ${member.email} from your team? They will lose access immediately.`,
      )
    )
      return;
    setBusyId(member.teamMemberId);
    setError("");
    setNotice("");
    try {
      await api.removeTeamMember(member.teamMemberId);
      setNotice(`${member.email} was removed.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-6">
      {/* Seat summary */}
      {seats && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">
            Seats & billing
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat label="Total seats" value={seats.teamSize} />
            <Stat
              label="Included"
              value={seats.includedSeats == null ? "Unlimited" : seats.includedSeats}
            />
            <Stat label="Additional" value={seats.additionalSeats} />
            <Stat label="Monthly total" value={`$${seats.monthlyTotal}`} />
          </div>
          <p className="mt-3 text-xs text-gray-500">
            One seat is included for you (the owner). Each active team member uses
            a seat; seats beyond your plan's included count bill at $
            {seats.additionalSeatPrice}/seat/month. Pending invitations and
            deactivated members don't count until active.
          </p>
        </div>
      )}

      {/* Invite form */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-300">
          Invite a team member
        </h3>
        <form onSubmit={invite} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@business.com"
              className={inputClass}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputClass}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          {role === "sales_rep" && (
            <div>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Rep's phone, E.164 e.g. +15551234567"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500">
                The platform calls this phone first, then bridges the lead — the
                rep never sees the lead's real number.
              </p>
            </div>
          )}
          {notice && <p className="text-sm text-green-500">{notice}</p>}
          <ErrorBanner message={error} />
          <button disabled={inviting} className={primaryBtn}>
            {inviting ? "Sending…" : "Send invitation"}
          </button>
        </form>
      </div>

      {/* Members list */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-300">Team members</h3>
        {loading ? (
          <Spinner label="Loading team…" />
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-400">
            No team members yet. Invite someone above to collaborate in your
            workspace.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Phone</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Last active</th>
                  <th className="py-2 pr-4 font-medium text-right">Calls (7d)</th>
                  <th className="py-2 pr-4 font-medium text-right">Leads (7d)</th>
                  <th className="py-2 pr-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const busy = busyId === m.teamMemberId;
                  const removed = m.status === "removed";
                  const deactivated = m.status === "deactivated";
                  const inactive = removed || deactivated;
                  return (
                    <tr
                      key={m.teamMemberId}
                      className="border-b border-gray-800/60"
                    >
                      <td className="py-3 pr-4 text-gray-200">{m.email}</td>
                      <td className="py-3 pr-4">
                        {inactive ? (
                          <RoleBadge role={m.role} />
                        ) : (
                          <select
                            value={m.role}
                            disabled={busy}
                            onChange={(e) => changeRole(m, e.target.value)}
                            className="rounded-lg border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 disabled:opacity-60"
                          >
                            {ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {roleLabel(r.value)}
                              </option>
                            ))}
                            {/* Preserve a legacy role so it isn't silently changed */}
                            {!ROLES.some((r) => r.value === m.role) && (
                              <option value={m.role}>{roleLabel(m.role)}</option>
                            )}
                          </select>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {m.phone ? (
                          <span className="text-gray-300">{m.phone}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                        {!inactive && (
                          <button
                            onClick={() => editPhone(m)}
                            disabled={busy}
                            className="ml-2 text-xs text-amber-400 hover:underline disabled:opacity-60"
                          >
                            edit
                          </button>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="py-3 pr-4 text-gray-400">
                        {fmtLastActive(m.lastActiveAt)}
                      </td>
                      <td className="py-3 pr-4 text-right text-gray-300">
                        {m.weekCalls ?? 0}
                      </td>
                      <td className="py-3 pr-4 text-right text-gray-300">
                        {m.weekLeadsWorked ?? 0}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex justify-end gap-2">
                          {m.status === "pending" && (
                            <button
                              onClick={() => resend(m)}
                              disabled={busy}
                              className="rounded-lg border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-60"
                            >
                              {busy ? "…" : "Resend"}
                            </button>
                          )}
                          {deactivated && (
                            <button
                              onClick={() => reactivate(m)}
                              disabled={busy}
                              className="rounded-lg border border-green-900 px-3 py-1 text-xs font-semibold text-green-400 hover:bg-green-950 disabled:opacity-60"
                            >
                              {busy ? "…" : "Reactivate"}
                            </button>
                          )}
                          {!inactive && (
                            <button
                              onClick={() => deactivate(m)}
                              disabled={busy}
                              className="rounded-lg border border-amber-900 px-3 py-1 text-xs font-semibold text-amber-400 hover:bg-amber-950 disabled:opacity-60"
                            >
                              {busy ? "…" : "Deactivate"}
                            </button>
                          )}
                          {!removed && (
                            <button
                              onClick={() => remove(m)}
                              disabled={busy}
                              className="rounded-lg border border-red-900 px-3 py-1 text-xs font-semibold text-red-400 hover:bg-red-950 disabled:opacity-60"
                            >
                              {busy ? "…" : "Remove"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-gray-100">{value}</div>
    </div>
  );
}
