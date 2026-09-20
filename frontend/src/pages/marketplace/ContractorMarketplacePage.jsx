import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMarketplaceContractors, updateOrganization } from "../../api/organizations";
import { assetUrl } from "../../api/client";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../context/AuthContext";

const PAGE_SIZE = 8;
const specialtiesFor = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
const initialsFor = (name) => String(name || "C").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
function Stars({ rating }) { const rounded = Math.round(Number(rating || 0)); return <span className="rating-stars">{"★".repeat(rounded)}{"☆".repeat(5 - rounded)}</span>; }

export default function ContractorMarketplacePage() {
  const { user } = useAuth();
  const isSuperAdmin = String(user?.role_code || "").toUpperCase() === "SUPER_ADMIN";
  const [contractors, setContractors] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState("All categories");
  const [location, setLocation] = useState("All locations");
  const [sort, setSort] = useState("rating");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  async function loadMarketplace() {
    setIsLoading(true); setError("");
    try { setContractors(await fetchMarketplaceContractors({ search: searchTerm, include_unpublished: isSuperAdmin })); }
    catch (err) { setError(err.response?.data?.error || "Unable to load marketplace."); }
    finally { setIsLoading(false); }
  }
  useEffect(() => { const timeoutId = window.setTimeout(loadMarketplace, 180); return () => window.clearTimeout(timeoutId); }, [isSuperAdmin, searchTerm]);

  const categories = useMemo(() => ["All categories", ...new Set(contractors.flatMap((contractor) => specialtiesFor(contractor.specializations)))].slice(0, 8), [contractors]);
  const locations = useMemo(() => ["All locations", ...new Set(contractors.map((contractor) => contractor.coverage_area).filter(Boolean))], [contractors]);
  const filteredContractors = useMemo(() => {
    const filtered = contractors.filter((contractor) => {
      const matchesCategory = category === "All categories" || specialtiesFor(contractor.specializations).some((item) => item.toLowerCase() === category.toLowerCase());
      return matchesCategory && (location === "All locations" || String(contractor.coverage_area || "").toLowerCase().includes(location.toLowerCase()));
    });
    return [...filtered].sort((a, b) => sort === "name" ? String(a.name).localeCompare(String(b.name)) : Number(b.average_rating || 0) - Number(a.average_rating || 0));
  }, [category, contractors, location, sort]);
  const totalPages = Math.max(1, Math.ceil(filteredContractors.length / PAGE_SIZE));
  const pageContractors = filteredContractors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [category, location, searchTerm, sort]);

  async function toggleListing(contractor) {
    setError("");
    try { await updateOrganization(contractor.id, { marketplace_enabled: !contractor.marketplace_enabled }); setStatusMessage(contractor.marketplace_enabled ? `${contractor.name} has been hidden from the marketplace.` : `${contractor.name} has been published to the marketplace.`); loadMarketplace(); }
    catch (err) { setError(err.response?.data?.error || "Unable to update marketplace visibility."); }
  }

  return <section className="marketplace-workspace">
    <PageHeader eyebrow="Marketplace" title="Find trusted contractors." description="Vetted professionals and reliable service partnerships, all in one place." />
    <section className="marketplace-controls panel">
      <label className="marketplace-search"><span className="visually-hidden">Search contractors</span><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search contractors, trades, or services..." /></label>
      <label className="marketplace-location"><span>Location</span><select value={location} onChange={(event) => setLocation(event.target.value)}>{locations.map((item) => <option key={item}>{item}</option>)}</select></label>
      <button type="button" className="button button-primary" onClick={() => setPage(1)}>Search</button>
      <label className="marketplace-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="rating">Best match</option><option value="name">Company name</option></select></label>
    </section>
    <div className="marketplace-category-row">{categories.map((item) => <button type="button" key={item} className={category === item ? "marketplace-category active" : "marketplace-category"} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <div className="marketplace-result-bar"><span>{filteredContractors.length} contractor{filteredContractors.length === 1 ? "" : "s"} found{location !== "All locations" ? ` in ${location}` : ""}</span><span>Page {page} of {totalPages}</span></div>
    {error ? <div className="panel form-error">{error}</div> : null}{statusMessage ? <div className="panel form-success">{statusMessage}</div> : null}
    <div className="marketplace-listings">{isLoading ? <div className="panel">Loading contractor marketplace...</div> : null}{!isLoading && pageContractors.map((contractor) => {
      const specialties = specialtiesFor(contractor.specializations); const isOwnOrganization = String(user?.organization_id || "") === String(contractor.id);
      return <article key={contractor.id} className="marketplace-listing-card"><div className="marketplace-company-mark">{contractor.logo_image_url ? <img src={assetUrl(contractor.logo_image_url)} alt="" /> : initialsFor(contractor.name)}</div><div className="marketplace-listing-copy"><h3>{contractor.name}</h3><p>{contractor.marketplace_tagline || specialties[0] || "Approved service contractor"}</p></div><div className="marketplace-listing-meta"><span>Location: {contractor.coverage_area || "Coverage on request"}</span><span><Stars rating={contractor.average_rating} /> {Number(contractor.average_rating || 0).toFixed(1)} ({contractor.review_count || 0})</span><span>Experience: {contractor.years_in_service == null ? "On request" : `${contractor.years_in_service} years`}</span></div><div className="marketplace-listing-actions"><Link to={`/marketplace/${contractor.id}`} className="button button-secondary button-small">View profile</Link>{isSuperAdmin ? <button type="button" className="button button-secondary button-small" onClick={() => toggleListing(contractor)}>{contractor.marketplace_enabled ? "Hide" : "Publish"}</button> : null}{isOwnOrganization ? <Link to={`/organizations/${contractor.id}?section=marketplace`} className="button button-secondary button-small">Edit</Link> : null}</div></article>;
    })}{!isLoading && !filteredContractors.length ? <div className="panel">No contractor listings match these filters yet.</div> : null}</div>
    {totalPages > 1 ? <nav className="marketplace-pagination" aria-label="Marketplace pages"><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => <button type="button" key={number} className={page === number ? "active" : ""} onClick={() => setPage(number)}>{number}</button>)}<button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>Next</button></nav> : null}
  </section>;
}
