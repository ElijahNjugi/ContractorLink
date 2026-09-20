import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchSlaAgreements } from "../../api/slaAgreements";
import PageHeader from "../../components/layout/PageHeader";

function label(value) {
  return String(value || "DRAFT").toLowerCase().replace(/_/g, " ");
}

export default function SlaAgreementsPage() {
  const [agreements, setAgreements] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setAgreements(await fetchSlaAgreements());
      } catch (err) {
        setError(err.response?.data?.error || "Unable to load SLA agreements.");
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  return <section className="stack-lg">
    <PageHeader eyebrow="Service agreements" title="SLA Agreements" description="Draft, review, approve, and monitor the service commitments that govern client-contractor work." />
    {error ? <div className="panel form-error">{error}</div> : null}
    {isLoading ? <div className="panel">Loading SLA agreements...</div> : null}
    {!isLoading ? <div className="grid-cards agreement-grid">
      {agreements.map((agreement) => <article className="panel agreement-card" key={agreement.id}>
        <div className="tag-row"><span className="tag">SLA agreement</span><span className={`status-pill status-${String(agreement.status).toLowerCase().replace(/_/g, "-")}`}>{label(agreement.status)}</span></div>
        <h3>{agreement.agreement_name}</h3>
        <p>{agreement.client_organization_name} <span className="muted-text">and</span> {agreement.contractor_organization_name}</p>
        <p className="section-copy">{agreement.description || "No service scope added yet."}</p>
        <Link to={`/sla-agreements/${agreement.id}`} className="button button-secondary button-small">Open agreement</Link>
      </article>)}
      {!agreements.length ? <div className="panel">No SLA agreements yet. Start from an active partnership to draft the first one.</div> : null}
    </div> : null}
  </section>;
}
