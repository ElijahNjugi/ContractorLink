import client from "./client";

export async function fetchWorkspaceContext() {
  const { data } = await client.get("/workspace-context/me");
  return data;
}
