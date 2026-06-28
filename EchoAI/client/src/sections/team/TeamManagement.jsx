import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";

const inputClass =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const primaryBtn =
  "rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";

const ROLES = [
  { value: "viewer", label: "Viewer — read-only access" },
  { value: "manager", label: "Manager — can create & edit content" },
  { value: "admin", label: "Admin — manage team & billing" },
];

function roleLabel(role) {
  const r = ROLES.find((x) => x.value === role);
  return r ? r.label.split(" — ")[0] : role;
}

function StatusBadge({ status }) {
  const map = {
    active: "bg-green-500/15 text-green-400",
    pending: "bg-amber-500/15 text-amber-300",
    removed: "bg-gray-500/15 text-gray-400",
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

export default function TeamManagement() {
  const [members, setMembers] = useState([]);
  const [seats, setSeats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Invite form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
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
    setInviting(true);
    setError("");
    setNotice("");
    try {
      const res = await api.inviteTeamMember(email.trim(), role);
      setNotice(
        res.status === "active"
          ? `${email.trim()} was added to your team.`
          : `Invitation sent to ${email.trim()}.`
      );
      setEmail("");
      setRole("viewer");
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
    setBusyId(member.teamMemberId);
    setError("");
    setNotice("");
    try {
      await api.changeTeamRole(member.teamMemberId, nextRole);
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
        `Remove ${member.email} from your team? They will lose access immediately.`
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
            <Stat
              label="Monthly total"
              value={`$${seats.monthlyTotal}`}
            />
          </div>
          <p className="mt-3 text-xs text-gray-500">
            One seat is included for you (the owner). Each active team member uses
            a seat; seats beyond your plan's included count bill at $
            {seats.additionalSeatPrice}/seat/month. Pending invitations don't
            count until accepted.
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
          {notice && <p className="text-sm text-green-500">{notice}</p>}
          <ErrorBanner message={error} />
          <button disabled={inviting} className={primaryBtn}>
            {inviting ? "Sending…" : "Send invitation"}
          </button>
        </form>
      </div>

      {/* Members list */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-300">
          Team members
        </h3>
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
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const busy = busyId === m.teamMemberId;
                  const removed = m.status === "removed";
                  return (
                    <tr
                      key={m.teamMemberId}
                      className="border-b border-gray-800/60"
                    >
                      <td className="py-3 pr-4 text-gray-200">{m.email}</td>
                      <td className="py-3 pr-4">
                        {removed ? (
                          <span className="text-gray-400">{roleLabel(m.role)}</span>
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
                          </select>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={m.status} />
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
