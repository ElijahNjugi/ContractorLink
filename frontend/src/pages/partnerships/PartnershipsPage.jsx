import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPartnerships, updatePartnership } from "../../api/partnerships";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../context/AuthContext";

function displayStatus(value) {
  return String(value || "PENDING").toLowerCase().replace(/_/g, " ");
}

export default function PartnershipsPage() {
  const { user } = useAuth();
  const isSuperAdmin = String(user?.role_code || "").toUpperCase() === "SUPER_ADMIN";
  const [partnerships, setPartnerships] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [selectedPartnership, setSelectedPartnership] = useState(null);

  async function load() {
    setIsLoading(true);
    setError("");
    try {
      setPartnerships(await fetchPartnerships());
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load collaboration requests.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function decide(partnership, status) {
    setUpdatingId(partnership.id);
    setError("");
    setSuccessMessage("");
    try {
      const updated = await updatePartnership(partnership.id, { status });
      setSelectedPartnership((current) => current?.id === partnership.id ? { ...current, ...updated } : current);
      setSuccessMessage(status === "ACTIVE" ? "Partnership accepted. You can now prepare the SLA agreement." : "Collaboration request declined.");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update collaboration request.");
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <section className="stack-lg">
      <PageHeader
        eyebrow="Collaboration"
        title={isSuperAdmin ? "Partnership oversight" : "Client-contractor partnerships"}
        description={isSuperAdmin ? "Monitor collaboration requests and active business relationships across the platform." : "Review requests, confirm active relationships, and move approved work into an SLA agreement."}
      />

      {error ? <div className="panel form-error">{error}</div> : null}
      {successMessage ? <div className="panel form-success">{successMessage}</div> : null}
      {isLoading ? <div className="panel">Loading partnerships...</div> : null}

      {!isLoading && selectedPartnership ? (() => {
        const partnership = selectedPartnership;
        const isReceivingContractor = String(partnership.contractor_organization_id) === String(user?.organization_id);
        const canDecide = partnership.status === "PENDING" && isReceivingContractor && !isSuperAdmin;
        return <article className="panel partnership-detail stack-md"><div className="card-actions"><button className="button button-secondary button-small" onClick={() => setSelectedPartnership(null)}>Back to partnerships</button><span className={`status-pill status-${String(partnership.status).toLowerCase()}`}>{displayStatus(partnership.status)}</span></div><span className="eyebrow">Client to contractor</span><h2>{partnership.client_organization_name} <span className="muted-text">to</span> {partnership.contractor_organization_name}</h2><div className="request-note"><span>Request message</span><p>{partnership.notes || "No message was included with this request."}</p></div>{canDecide ? <div className="card-actions"><button className="button button-primary button-small" onClick={() => decide(partnership, "ACTIVE")} disabled={updatingId === partnership.id}>{updatingId === partnership.id ? "Saving..." : "Accept request"}</button><button className="button button-secondary button-small" onClick={() => decide(partnership, "REJECTED")} disabled={updatingId === partnership.id}>Decline</button></div> : null}{partnership.status === "ACTIVE" ? <div className="stack-sm"><p className="partnership-ready">Ready for SLA agreement setup.</p>{String(partnership.client_organization_id) === String(user?.organization_id) ? <Link to={`/sla-agreements/new?partnershipId=${partnership.id}`} className="button button-primary button-small">Draft SLA agreement</Link> : <Link to="/sla-agreements" className="button button-secondary button-small">View SLA agreements</Link>}</div> : null}</article>;
      })() : null}

      {!isLoading && !selectedPartnership ? <div className="grid-cards partnership-grid">
        {partnerships.map((partnership) => {
          return <article className="panel partnership-card" key={partnership.id}>
            <div className="tag-row"><span className="tag">Client to contractor</span><span className={`status-pill status-${String(partnership.status).toLowerCase()}`}>{displayStatus(partnership.status)}</span></div>
            <h3>{partnership.client_organization_name}</h3>
            <p className="partnership-arrow">wants to work with</p>
            <h3>{partnership.contractor_organization_name}</h3>
            <button className="button button-secondary button-small" onClick={() => setSelectedPartnership(partnership)}>Open partnership</button>
          </article>;
        })}
        {!partnerships.length ? <div className="panel">No collaboration requests yet. Clients can begin from a contractor marketplace profile.</div> : null}
      </div> : null}
    </section>
  );
}
