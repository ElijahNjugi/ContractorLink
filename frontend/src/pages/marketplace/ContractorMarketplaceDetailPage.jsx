import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchMarketplaceContractor,
  requestMarketplacePartnership,
  submitContractorReview,
} from "../../api/organizations";
import { fetchTickets } from "../../api/tickets";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../context/AuthContext";
import { assetUrl } from "../../api/client";

function specialties(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function Stars({ value }) {
  const rounded = Math.round(Number(value || 0));
  return <span className="rating-stars">{"★".repeat(rounded)}{"☆".repeat(5 - rounded)}</span>;
}

export default function ContractorMarketplaceDetailPage() {
  const { contractorId } = useParams();
  const { user } = useAuth();
  const [contractor, setContractor] = useState(null);
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [completedTickets, setCompletedTickets] = useState([]);
  const [reviewTicketId, setReviewTicketId] = useState("");
  const [reviewRating, setReviewRating] = useState("5");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const isOwnOrganization = String(user?.organization_id || "") === String(contractorId);
  const isClientAdmin = String(user?.role_code || "").toUpperCase() === "ORG_ADMIN" && !isOwnOrganization;

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const contractorProfile = await fetchMarketplaceContractor(contractorId);
        setContractor(contractorProfile);
        if (String(user?.role_code || "").toUpperCase() === "ORG_ADMIN" && String(user?.organization_id || "") !== String(contractorId)) {
          const ticketData = await fetchTickets({ status: "COMPLETED" });
          setCompletedTickets(
            ticketData.filter(
              (ticket) =>
                String(ticket.requesting_organization_id) === String(user?.organization_id) &&
                String(ticket.assigned_organization_id) === String(contractorProfile.id)
            )
          );
        }
      } catch (err) {
        setError(err.response?.data?.error || "Unable to load this contractor profile.");
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [contractorId, user?.organization_id, user?.role_code]);

  async function submitRequest(event) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setIsSubmitting(true);
    try {
      await requestMarketplacePartnership(contractorId, { notes });
      setSuccessMessage("Collaboration request sent. The contractor can now accept or decline it from their workspace.");
      setNotes("");
    } catch (err) {
      setError(err.response?.data?.error || "Unable to send collaboration request.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitReview(event) {
    event.preventDefault();
    setReviewMessage("");
    setError("");
    setIsSubmittingReview(true);
    try {
      await submitContractorReview(contractorId, {
        ticket_id: reviewTicketId,
        rating: Number(reviewRating),
        comment: reviewComment,
      });
      setReviewMessage("Thank you. Your verified review is now visible on this contractor profile.");
      setReviewTicketId("");
      setReviewRating("5");
      setReviewComment("");
      const refreshed = await fetchMarketplaceContractor(contractorId);
      setContractor(refreshed);
      setCompletedTickets((tickets) => tickets.filter((ticket) => ticket.id !== reviewTicketId));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to submit review.");
    } finally {
      setIsSubmittingReview(false);
    }
  }

  if (isLoading) return <div className="panel">Loading contractor profile...</div>;
  if (!contractor) return <div className="panel form-error">{error || "Contractor not found."}</div>;

  const contractorSpecialties = specialties(contractor.specializations);
  const reviews = Array.isArray(contractor.reviews) ? contractor.reviews : [];

  return (
    <section className="stack-lg">
      <PageHeader
        eyebrow="Contractor profile"
        title={contractor.name}
        description={contractor.marketplace_tagline || "Verified contractor profile on ContractorLink."}
        actions={<Link to="/marketplace" className="button button-secondary">Back to marketplace</Link>}
      />

      <article className="panel marketplace-profile-hero" style={contractor.cover_image_url ? { backgroundImage: `linear-gradient(90deg, rgba(255,253,249,.94), rgba(255,253,249,.72)), url(${assetUrl(contractor.cover_image_url)})` } : undefined}>
        <div className="marketplace-profile-mark">{contractor.logo_image_url ? <img src={assetUrl(contractor.logo_image_url)} alt="" /> : contractor.name.slice(0, 1).toUpperCase()}</div>
        <div className="stack-sm">
          <span className="tag">{contractor.organization_type}</span>
          <h2>{contractor.name}</h2>
          <div className="rating-line"><Stars value={contractor.average_rating} /> <strong>{Number(contractor.average_rating || 0).toFixed(1)}</strong><span>from {contractor.review_count || 0} verified reviews</span></div>
        </div>
        <div className="marketplace-profile-stat"><span>Coverage</span><strong>{contractor.coverage_area || "Not specified"}</strong></div>
        <div className="marketplace-profile-stat"><span>Experience</span><strong>{contractor.years_in_service == null ? "Not specified" : `${contractor.years_in_service} years`}</strong></div>
      </article>

      <div className="split-layout marketplace-detail-layout">
        <div className="stack-lg">
          <article className="panel stack-md">
            <div><span className="eyebrow">Services</span><h3>What this contractor offers</h3></div>
            <p className="profile-copy">{contractor.service_summary || contractor.description || "This contractor has not added a service summary yet."}</p>
            {contractorSpecialties.length ? <div className="chip-row">{contractorSpecialties.map((item) => <span className="meta-chip" key={item}>{item}</span>)}</div> : <p className="muted-text">Specializations have not been listed yet.</p>}
          </article>

          <article className="panel stack-md">
            <div><span className="eyebrow">Client feedback</span><h3>Verified marketplace reviews</h3></div>
            {reviews.length ? <div className="review-list">{reviews.map((review) => <article key={review.id} className="review-card"><div className="review-card-top"><strong>{review.client_organization_name}</strong><Stars value={review.rating} /></div>{review.comment ? <p>{review.comment}</p> : <p className="muted-text">No written comment was left.</p>}</article>)}</div> : <p className="muted-text">Reviews appear here after verified client work is completed.</p>}
            {isClientAdmin && completedTickets.length ? <form className="review-form stack-md" onSubmit={submitReview}><div><span className="eyebrow">Leave a review</span><p className="section-copy">Your rating is connected to a completed ticket and can be submitted once per ticket.</p></div><div className="form-grid"><label className="field"><span>Completed ticket</span><select value={reviewTicketId} onChange={(event) => setReviewTicketId(event.target.value)} required><option value="">Choose completed work</option>{completedTickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.ticket_number} - {ticket.title}</option>)}</select></label><div className="field"><span>Your rating</span><div className="rating-star-picker" role="radiogroup" aria-label="Your rating">{[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" className={rating <= Number(reviewRating) ? "rating-star selected" : "rating-star"} onClick={() => setReviewRating(String(rating))} role="radio" aria-checked={rating === Number(reviewRating)} aria-label={`${rating} star${rating === 1 ? "" : "s"}`}>★</button>)}</div><small>{reviewRating} out of 5 stars</small></div></div><label className="field"><span>Comment (optional)</span><textarea rows="3" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="Share a concise, fair comment about the completed work." /></label><button className="button button-primary" disabled={isSubmittingReview}>{isSubmittingReview ? "Publishing review..." : "Publish verified review"}</button>{reviewMessage ? <div className="form-success">{reviewMessage}</div> : null}</form> : null}
          </article>
        </div>

        <aside className="panel partnership-request-card stack-md">
          <span className="eyebrow">Start collaboration</span>
          <h3>Work with {contractor.name}</h3>
          <p className="section-copy">Send a request with a short description of the work. Once the contractor accepts, both organizations can prepare their SLA agreement.</p>
          {isOwnOrganization ? <Link to={`/organizations/${contractor.id}?section=marketplace`} className="button button-primary">Edit my marketplace profile</Link> : null}
          {isClientAdmin ? <form className="stack-md" onSubmit={submitRequest}><label className="field"><span>Message to contractor</span><textarea rows="5" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Briefly describe the service you need and your expected scope." /></label><button className="button button-primary" disabled={isSubmitting}>{isSubmitting ? "Sending request..." : "Request collaboration"}</button></form> : null}
          {!isOwnOrganization && !isClientAdmin ? <p className="muted-text">An Organization Admin from a client organization can send a collaboration request.</p> : null}
          {error ? <div className="form-error">{error}</div> : null}
          {successMessage ? <div className="form-success">{successMessage}</div> : null}
        </aside>
      </div>
    </section>
  );
}
