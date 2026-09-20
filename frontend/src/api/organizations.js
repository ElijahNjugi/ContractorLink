import client from "./client";

export async function submitOrganizationApplication(payload) {
  const { data } = await client.post("/organization-applications", payload);
  return data;
}

export async function fetchOrganizationApplicationStatus(applicationId, email) {
  const { data } = await client.get("/organization-applications/status", {
    params: {
      application_id: applicationId,
      email,
    },
  });
  return data;
}

export async function respondToConditionalApplication(id, payload) {
  const { data } = await client.patch(`/organization-applications/${id}/respond`, payload);
  return data;
}

export async function fetchOrganizationApplications(params = {}) {
  const { data } = await client.get("/organization-applications", {
    params,
  });
  return data;
}

export async function fetchOrganizationApplication(id) {
  const { data } = await client.get(`/organization-applications/${id}`);
  return data;
}

export async function reviewOrganizationApplication(id, payload) {
  const { data } = await client.patch(
    `/organization-applications/${id}/review`,
    payload
  );
  return data;
}

export async function updateOrganizationApplicationVisibility(id, hide) {
  const { data } = await client.patch(`/organization-applications/${id}/visibility`, {
    hide,
  });
  return data;
}

export async function fetchOrganizations(params = {}) {
  const { data } = await client.get("/organizations", {
    params,
  });
  return data;
}

export async function fetchMarketplaceContractors(params = {}) {
  const { data } = await client.get("/organizations/marketplace/contractors", {
    params,
  });
  return data;
}

export async function fetchMarketplaceContractor(id) {
  const { data } = await client.get(`/organizations/marketplace/contractors/${id}`);
  return data;
}

export async function requestMarketplacePartnership(contractorId, payload) {
  const { data } = await client.post(
    `/organizations/marketplace/contractors/${contractorId}/partnership-requests`,
    payload
  );
  return data;
}

export async function submitContractorReview(contractorId, payload) {
  const { data } = await client.post(
    `/organizations/marketplace/contractors/${contractorId}/reviews`,
    payload
  );
  return data;
}

export async function fetchOrganization(id) {
  const { data } = await client.get(`/organizations/${id}`);
  return data;
}

export async function createOrganization(payload) {
  const { data } = await client.post("/organizations", payload);
  return data;
}

export async function updateOrganization(id, payload) {
  const { data } = await client.patch(`/organizations/${id}`, payload);
  return data;
}

export async function fetchOrganizationContacts(organizationId) {
  const { data } = await client.get("/organization-contacts", {
    params: organizationId ? { organization_id: organizationId } : undefined,
  });
  return data;
}

export async function createOrganizationContact(payload) {
  const { data } = await client.post("/organization-contacts", payload);
  return data;
}

export async function updateOrganizationContact(id, payload) {
  const { data } = await client.patch(`/organization-contacts/${id}`, payload);
  return data;
}

export async function fetchOrganizationUsers(organizationId) {
  const { data } = await client.get("/organization-users", {
    params: organizationId ? { organization_id: organizationId } : undefined,
  });
  return data;
}

export async function createOrganizationUser(payload) {
  const { data } = await client.post("/organization-users", payload);
  return data;
}

export async function updateOrganizationUser(id, payload) {
  const { data } = await client.patch(`/organization-users/${id}`, payload);
  return data;
}

export async function resetOrganizationUserAccess(id) {
  const { data } = await client.post(`/organization-users/${id}/reset-access`);
  return data;
}

export async function fetchDepartments(organizationId) {
  const { data } = await client.get("/departments", {
    params: organizationId ? { organization_id: organizationId } : undefined,
  });
  return data;
}

export async function createDepartment(payload) {
  const { data } = await client.post("/departments", payload);
  return data;
}

export async function updateDepartment(id, payload) {
  const { data } = await client.patch(`/departments/${id}`, payload);
  return data;
}

export async function fetchDepartmentUsers(id) {
  const { data } = await client.get(`/departments/${id}/users`);
  return data;
}
