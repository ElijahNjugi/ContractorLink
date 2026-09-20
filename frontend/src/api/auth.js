import client from "./client";

export async function loginUser(payload) {
  const { data } = await client.post("/auth/login", payload);
  return data;
}

export async function fetchCurrentUser() {
  const { data } = await client.get("/auth/me");
  return data;
}

export async function changePassword(payload) {
  const { data } = await client.post("/auth/change-password", payload);
  return data;
}

export async function requestPasswordChange() {
  const { data } = await client.post("/auth/request-password-change");
  return data;
}

export async function requestForgotPassword(payload) {
  const { data } = await client.post("/auth/forgot-password", payload);
  return data;
}

export async function validateResetPasswordToken(token) {
  const { data } = await client.get("/auth/reset-password/validate", {
    params: { token },
  });
  return data;
}

export async function confirmResetPassword(payload) {
  const { data } = await client.post("/auth/reset-password/confirm", payload);
  return data;
}
