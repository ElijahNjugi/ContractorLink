import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTickets } from "../../api/tickets";
import PageHeader from "../../components/layout/PageHeader";
import SlaClock from "../../components/tickets/SlaClock";

const label = (value) => String(value || "OPEN").replace(/_/g, " ").toLowerCase();
const stars = (value) => "★".repeat(Number(value || 1)) + "☆".repeat(3 - Number(value || 1));

export default function TicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState("ACTIVE");
  const [error, setError] = useState("");
  useEffect(() => { fetchTickets().then(setTickets).catch((err) => setError(err.response?.data?.error || "Unable to load tickets.")); }, []);
  const visible = tickets.filter((ticket) => filter === "ALL" || (filter === "PAST" ? ["COMPLETED", "CANCELLED"].includes(ticket.status) : !["COMPLETED", "CANCELLED"].includes(ticket.status)));
  return <section className="stack-lg">
    <PageHeader eyebrow="Ticket operations" title="Tickets" description="Create work requests from an active SLA and monitor the agreed response and resolution time." actions={<Link className="button" to="/tickets/new">+ Create ticket</Link>} />
    <div className="panel filter-row"><strong>Show</strong>{["ACTIVE", "PAST", "ALL"].map((value) => <button key={value} type="button" className={`button button-small ${filter === value ? "" : "button-secondary"}`} onClick={() => setFilter(value)}>{value === "ACTIVE" ? "Active tickets" : value === "PAST" ? "Past tickets" : "All tickets"}</button>)}</div>
    {error ? <div className="panel form-error">{error}</div> : null}
    <div className="ticket-board">{visible.map((ticket) => <article className="panel ticket-card" key={ticket.id}>
      <div className="tag-row"><span className="tag">{ticket.ticket_number}</span><span className={`status-pill status-${String(ticket.status).toLowerCase()}`}>{label(ticket.status)}</span></div>
      <h3>{ticket.title}</h3><p className="ticket-card-description">{ticket.description}</p><p>{ticket.requesting_organization_name} <span className="muted-text">to</span> {ticket.assigned_organization_name}</p><p className="muted-text">Assigned: {ticket.assigned_user_name || ticket.assigned_department_name || ticket.assigned_organization_name}</p>
      <p className="priority-stars" aria-label={`${ticket.priority_level} star priority`}>{stars(ticket.priority_level)}</p>
      <SlaClock compact startTime={ticket.start_time} endTime={ticket.expected_end_time} status={ticket.sla_status} />
      <Link to={`/tickets/${ticket.id}`} className="button button-secondary button-small">Open ticket</Link>
    </article>)}{!visible.length ? <div className="panel">No tickets in this view yet.</div> : null}</div>
  </section>;
}
