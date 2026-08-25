export async function exchangeCodeForToken(code) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const err = new Error(
      "DISCORD_CLIENT_ID と DISCORD_CLIENT_SECRET を .env に設定してください",
    );
    err.status = 500;
    throw err;
  }

  if (!code || typeof code !== "string") {
    const err = new Error("authorization code がありません");
    err.status = 400;
    throw err;
  }

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const err = new Error(
      data.error_description || data.error || "Discord token exchange failed",
    );
    err.status = 502;
    err.payload = data;
    throw err;
  }

  return {
    access_token: data.access_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    scope: data.scope,
  };
}

export async function proxyDiscordAvatar(userId, avatarHash) {
  if (!/^\d{5,32}$/.test(userId) || !/^[a-zA-Z0-9_]+$/.test(avatarHash)) {
    return null;
  }
  const url = `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=64`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get("content-type") || "image/png",
  };
}
