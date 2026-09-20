import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchTicket } from "../../api/tickets";
import PageHeader from "../../components/layout/PageHeader";
import TicketHoldPanel from "../../components/tickets/TicketHoldPanel";
export default function TicketHoldPage() { const { ticketId } = useParams(); const [ticket, setTicket] = useState(null); const [error, setError] = useState(""); useEffect(() => { fetchTicket(ticketId).then(setTicket).catch((err) => setError(err.response?.data?.error || "Unable to load ticket.")); }, [ticketId]); if (error) return <div className="panel form-error">{error}</div>; if (!ticket) return <div className="panel">Loading hold requests...</div>; return <section className="stack-lg"><PageHeader eyebrow={ticket.ticket_number} title="Hold requests" description={`Manage SLA pauses for ${ticket.title}.`} actions={<Link className="button button-secondary" to={`/tickets/${ticket.id}`}>Back to ticket</Link>} /><TicketHoldPanel ticket={ticket} /></section>; }
