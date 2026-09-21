import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { fetchTicket, updateTicket } from "../../api/tickets";
import PageHeader from "../../components/layout/PageHeader";

export default function TicketCompletionPage() {
  const { ticketId } = useParams(); const navigate = useNavigate(); const { user } = useAuth(); const [ticket, setTicket] = useState(null); const [note, setNote] = useState({ issue_found: "", fix_applied: "", resolution_note: "" }); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { fetchTicket(ticketId).then(setTicket).catch((err) => setError(err.response?.data?.error || "Unable to load ticket.")); }, [ticketId]);
  async function complete(event) { event.preventDefault(); if (!Object.values(note).some((value) => value.trim())) return setError("Add at least one record of the work completed."); setSaving(true); try { await updateTicket(ticket.id, { status: "COMPLETED", ...note }); navigate(`/tickets/${ticket.id}`); } catch (err) { setError(err.response?.data?.error || "Unable to complete ticket."); } finally { setSaving(false); } }
  if (error && !ticket) return <div className="panel form-error">{error}</div>; if (!ticket) return <div className="panel">Loading ticket...</div>;
  const allowed = String(user?.organization_id) === String(ticket.assigned_organization_id) && String(user?.role_code).toUpperCase() === "ORG_ADMIN" && !["COMPLETED", "CANCELLED", "FAILED", "ON_HOLD"].includes(ticket.status);
  if (!allowed) return <div className="panel form-error">Only the assigned contractor Organization Admin can complete an active ticket.</div>;
  return <section className="stack-lg"><PageHeader eyebrow={ticket.ticket_number} title="Complete ticket" description="Record a useful service history before closing this request." actions={<Link className="button button-secondary" to={`/tickets/${ticket.id}`}>Back to ticket</Link>} /><form className="panel stack-md ticket-completion-form" onSubmit={complete}><label className="field"><span>Issue found <em>(if applicable)</em></span><textarea value={note.issue_found} onChange={(event) => setNote({ ...note, issue_found: event.target.value })} disabled={saving} /></label><label className="field"><span>Work delivered or fix applied <em>(if applicable)</em></span><textarea value={note.fix_applied} onChange={(event) => setNote({ ...note, fix_applied: event.target.value })} disabled={saving} /></label><label className="field"><span>Resolution or completion note <em>(if applicable)</em></span><textarea value={note.resolution_note} onChange={(event) => setNote({ ...note, resolution_note: event.target.value })} disabled={saving} /></label>{error ? <div className="form-error">{error}</div> : null}<button className="button" disabled={saving}>{saving ? "Completing ticket..." : "Mark ticket completed"}</button></form></section>;
}
