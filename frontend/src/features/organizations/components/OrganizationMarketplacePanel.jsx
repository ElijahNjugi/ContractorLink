import { useState } from "react";
import { updateOrganization } from "../../../api/organizations";
import { assetUrl } from "../../../api/client";

function getInitialForm(organization) {
  return {
    marketplace_tagline: organization?.marketplace_tagline || "",
    service_summary: organization?.service_summary || "",
    coverage_area: organization?.coverage_area || "",
    specializations: organization?.specializations || "",
    years_in_service:
      organization?.years_in_service == null ? "" : String(organization.years_in_service),
    marketplace_enabled: organization?.marketplace_enabled ?? false,
  };
}

export default function OrganizationMarketplacePanel({
  organization,
  onSuccess,
}) {
  const [form, setForm] = useState(() => getInitialForm(organization));
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [branding, setBranding] = useState({ logo_image: null, profile_image: null, cover_image: null });

  async function selectBrandingImage(event, field) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) {
      setError("Choose a PNG, JPG, or WEBP image smaller than 3 MB.");
      return;
    }
    const contentBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setBranding((current) => ({ ...current, [field]: { content_base64: contentBase64, mime_type: file.type, preview: contentBase64 } }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      const saved = await updateOrganization(organization.id, {
        marketplace_tagline: form.marketplace_tagline.trim(),
        service_summary: form.service_summary.trim(),
        coverage_area: form.coverage_area.trim(),
        specializations: form.specializations.trim(),
        years_in_service: form.years_in_service.trim(),
        marketplace_enabled: form.marketplace_enabled,
        ...branding,
      });

      setForm(getInitialForm(saved));
      setSuccessMessage("Marketplace profile updated.");
      onSuccess?.(saved);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to save marketplace profile.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel stack-md">
      <div className="detail-header">
        <div>
          <span className="eyebrow">Marketplace profile</span>
          <h3>How clients will discover this contractor</h3>
          <p className="section-copy">
            Publish a clear contractor profile so clients can understand your specialties,
            service coverage, and readiness before requesting a partnership.
          </p>
        </div>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Short tagline</span>
          <input
            value={form.marketplace_tagline}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                marketplace_tagline: event.target.value,
              }))
            }
            placeholder="Example: Power infrastructure and field support specialists"
          />
        </label>

        <label className="field">
          <span>Coverage area</span>
          <input
            value={form.coverage_area}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                coverage_area: event.target.value,
              }))
            }
            placeholder="County, region, or national coverage"
          />
        </label>

        <label className="field">
          <span>Specializations</span>
          <input
            value={form.specializations}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                specializations: event.target.value,
              }))
            }
            placeholder="Comma-separated, e.g. networking, fiber, CCTV"
          />
        </label>

        <label className="field">
          <span>Years in service</span>
          <input
            type="number"
            min="0"
            value={form.years_in_service}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                years_in_service: event.target.value,
              }))
            }
            placeholder="0"
          />
        </label>
      </div>

      <label className="field">
        <span>Service summary</span>
        <textarea
          rows="5"
          value={form.service_summary}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              service_summary: event.target.value,
            }))
          }
          placeholder="Describe the services this contractor can deliver for client organizations."
        />
      </label>

      <section className="branding-editor">
        <div><span className="eyebrow">Company identity</span><h4>Add images clients will recognize</h4><p>Use clear images. The logo appears on marketplace cards; the profile and cover images appear on the company page.</p></div>
        <div className="branding-upload-grid">
          {[['logo_image', 'Company logo', organization?.logo_image_url], ['profile_image', 'Profile image', organization?.profile_image_url], ['cover_image', 'Cover image', organization?.cover_image_url]].map(([field, label, existingUrl]) => <label className="branding-upload" key={field}><span>{branding[field]?.preview || existingUrl ? <img src={branding[field]?.preview || assetUrl(existingUrl)} alt="" /> : label.slice(0, 1)}</span><strong>{label}</strong><small>{branding[field]?.preview ? "New image selected" : existingUrl ? "Current image" : "PNG, JPG, or WEBP"}</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectBrandingImage(event, field)} /></label>)}
        </div>
      </section>

      <label className="field checkbox-field">
        <input
          type="checkbox"
          checked={form.marketplace_enabled}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              marketplace_enabled: event.target.checked,
            }))
          }
        />
        <span>Show this contractor in the marketplace</span>
      </label>

      {error ? <div className="form-error">{error}</div> : null}
      {successMessage ? <div className="form-success">{successMessage}</div> : null}

      <button type="submit" className="button button-primary" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save marketplace profile"}
      </button>
    </form>
  );
}
