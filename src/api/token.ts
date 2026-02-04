type TokenResponse = {
  token: string;
  identity: string;
  room: string;
};

export async function createToken(baseUrl: string, livekitUrl: string): Promise<TokenResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ livekitUrl }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to create token");
  }

  return response.json();
}
