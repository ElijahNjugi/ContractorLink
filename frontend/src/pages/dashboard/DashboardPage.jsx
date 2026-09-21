import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { fetchTickets } from "../../api/tickets";
import { fetchSlaAgreements } from "../../api/slaAgreements";
import { fetchPartnerships } from "../../api/partnerships";
import { fetchWorkspaceContext } from "../../api/workspaceContext";
import { fetchMlSummary } from "../../api/ml";

function Metric({ label, value, note }) { return <article className="panel metric-card"><span className="metric-label">{label}</span><strong>{value}</strong><p>{note}</p></article>; }

function ActivityChart({ activeTickets, completed, breached }) {
  const values = [
    Math.max(1, activeTickets.length),
    Math.max(1, completed.length),
    Math.max(1, breached.length),
    Math.max(1, activeTickets.length + completed.length),
    Math.max(1, activeTickets.length + completed.length - breached.length),
  ];
  const highest = Math.max(...values);
  const labels = ["Open", "Done", "Risk", "All", "Health"];

  return <article className="panel dashboard-chart-card">
    <div className="dashboard-chart-heading"><div><span className="eyebrow">Activity pulse</span><h3>Service delivery snapshot</h3></div><span className="chart-live-dot">Live</span></div>
    <div className="dashboard-chart" role="img" aria-label="Visual summary of current ticket activity">
      {values.map((value, index) => <div className="dashboard-chart-column" key={labels[index]}><i style={{ height: `${Math.max(14, Math.round((value / highest) * 100))}%` }} /><span>{labels[index]}</span></div>)}
    </div>
    <p>Track the balance between active work, completed delivery, and SLA risk at a glance.</p>
  </article>;
}

export default function DashboardPage() {
  const { user } = useAuth(); const [data, setData] = useState({ tickets: [], agreements: [], partnerships: [] }); const [workspace, setWorkspace] = useState(null); const [mlSummary, setMlSummary] = useState(null); const [error, setError] = useState("");
  const superAdmin = String(user?.role_code || "").toUpperCase() === "SUPER_ADMIN";
  useEffect(() => { Promise.all([fetchTickets(), fetchSlaAgreements(), fetchPartnerships(), fetchWorkspaceContext(), superAdmin ? fetchMlSummary() : Promise.resolve(null)]).then(([tickets, agreements, partnerships, currentWorkspace, modelSummary]) => { setData({ tickets, agreements, partnerships }); setWorkspace(currentWorkspace); setMlSummary(modelSummary); }).catch(() => setError("Some live dashboard data is temporarily unavailable.")); }, [superAdmin]);
  const activeTickets = data.tickets.filter((t) => !["COMPLETED", "CANCELLED", "FAILED"].includes(t.status)); const completed = data.tickets.filter((t) => t.status === "COMPLETED"); const breached = data.tickets.filter((t) => ["BREACHED", "FAILED"].includes(t.sla_status)); const activeSlas = data.agreements.filter((a) => a.status === "ACTIVE"); const activePartnerships = data.partnerships.filter((p) => p.status === "ACTIVE"); const completionRate = data.tickets.length ? Math.round((completed.length / data.tickets.length) * 100) : 0;
  const workspaceName = workspace?.organization_name || (superAdmin ? "ContractorLink Platform" : user?.organization || "Organization workspace");
  const departments = workspace?.department_names || "No department assigned";
  const modelMessage = mlSummary?.model ? `Model ${mlSummary.model.version} is live with ${Math.round(Number(mlSummary.model.roc_auc || 0) * 100)}% validation accuracy from ${Number(mlSummary.model.training_rows || 0).toLocaleString()} training records. ${mlSummary.confirmed_outcomes || 0} confirmed ticket outcomes are ready for the next retraining run.` : "The breach-risk model has not been registered yet.";
  return <div className="stack-lg"><section className="hero-panel dashboard-hero"><span className="eyebrow">{superAdmin ? "Platform internal" : "ContractorLink workspace"}</span><h2>{superAdmin ? "Platform command centre" : "Service operations overview"}</h2><p>{superAdmin ? "Monitor platform growth, agreement health, and operational risk across every organization." : "See active service work, agreement health, and delivery progress in one place."}</p><div className="hero-actions"><Link className="button" to="/tickets">Open tickets</Link><Link className="button button-secondary" to="/sla-agreements">View SLA agreements</Link></div></section>{error ? <div className="panel form-error">{error}</div> : null}
    <section className="panel workspace-location"><div><span className="eyebrow">Current workspace</span><h3>{workspaceName}</h3><p>These details confirm exactly where you are working in ContractorLink.</p></div><div className="workspace-context-grid"><div><span>Signed in as</span><strong>{workspace?.full_name || user?.full_name || "Loading user"}</strong></div><div><span>Role</span><strong>{workspace?.role_name || user?.role_name || "Loading role"}</strong></div><div><span>Department</span><strong>{departments}</strong></div></div></section>
    <section className="grid-cards dashboard-metrics"><Metric label="Active tickets" value={activeTickets.length} note={activeTickets.length ? "Work currently in progress" : "No current work items"} /><Metric label="SLA health" value={`${data.tickets.length - breached.length}/${data.tickets.length || 0}`} note={breached.length ? `${breached.length} ticket${breached.length === 1 ? "" : "s"} breached` : "No SLA breaches"} /><Metric label="Completion rate" value={`${completionRate}%`} note={`${completed.length} completed ticket${completed.length === 1 ? "" : "s"}`} /><Metric label={superAdmin ? "Active organizations" : "Active partnerships"} value={superAdmin ? new Set(data.partnerships.flatMap((p) => [p.client_organization_id, p.contractor_organization_id])).size : activePartnerships.length} note={superAdmin ? "Organizations participating in work" : "Approved service relationships"} /></section>
    <section className="dashboard-visual-grid"><ActivityChart activeTickets={activeTickets} completed={completed} breached={breached} /><article className="panel dashboard-network-card"><div><span className="eyebrow">Agreement health</span><h3>Service network</h3></div><div className="dashboard-bar"><span>Active SLAs</span><strong>{activeSlas.length}</strong><i style={{ width: `${Math.min(100, activeSlas.length * 20)}%` }} /></div><div className="dashboard-bar"><span>Active partnerships</span><strong>{activePartnerships.length}</strong><i style={{ width: `${Math.min(100, activePartnerships.length * 20)}%` }} /></div><div className="dashboard-insight"><strong>{superAdmin ? "ML risk panel" : "Delivery insight"}</strong><p>{superAdmin ? modelMessage : "Use ticket SLA health indicators to act before work breaches its target."}</p></div></article></section>
    <section className="dashboard-columns"><article className="panel stack-md"><div><span className="eyebrow">Live work</span><h3>Priority queue</h3></div>{activeTickets.slice(0, 5).map((ticket) => <Link className="dashboard-ticket" to={`/tickets/${ticket.id}`} key={ticket.id}><span className={`dashboard-risk ${ticke["BREACHED", "FAILED"].includes(t.sla_status) ? "breached" : ""}`} /><div><strong>{ticket.title}</strong><small>{ticket.ticket_number} · {ticket.assigned_organization_name}</small></div><b>{"★".repeat(ticket.priority_level)}</b></Link>)}{!activeTickets.length ? <p className="muted-text">No active tickets right now.</p> : null}</article><article className="panel stack-md"><div><span className="eyebrow">At a glance</span><h3>Next best action</h3></div><div className="dashboard-insight"><strong>{breached.length ? "Review breached tickets" : activeTickets.length ? "Keep active work moving" : "Ready for new work"}</strong><p>{breached.length ? `${breached.length} ticket${breached.length === 1 ? " is" : "s are"} outside its target. Review the SLA escalation path now.` : activeTickets.length ? "Open the ticket queue to review owners, deadlines, and the latest conversations." : "Your workspace has no active tickets. Create a ticket or build an SLA for the next service request."}</p></div><div className="hero-actions"><Link className="button button-secondary" to="/tickets">Ticket board</Link><Link className="button button-secondary" to={superAdmin ? "/reports" : "/sla-agreements"}>{superAdmin ? "View reports" : "SLA agreements"}</Link></div></article></section>
  </div>;
}
